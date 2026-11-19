#!/usr/bin/env node
/**
 * Agent bridge. It connects three parties:
 *
 *   the app (a browser page)  <-- WebSocket -->  the bridge  <-- MCP -->  an agent
 *
 * Agents reach it in either of two ways, with the same tools either way:
 *   - by URL, http://127.0.0.1:<port>/mcp (MCP over streamable HTTP), which any
 *     MCP client can use: `claude mcp add --transport http ...`, `codex mcp add --url ...`
 *   - by starting this file as a stdio MCP server
 *
 * - An agent such as Claude Code starts this file as an MCP server. What it
 *   gets (tools, resources, prompts) is defined in mcp.js.
 * - Each open tab of the app connects over WebSocket (unless the person has
 *   switched "agent" off). Several tabs can be connected at once.
 * - The app's chat panel can ask the bridge to start an agent for one turn
 *   (see agents.js). That agent starts its own copy of this file.
 *
 * Every app has a bridge of its own: its own port (see config.js) and its own
 * folder, where the bridge keeps the app's files and reads its secrets. Several
 * copies can still run for ONE app: the first one to get the port is the hub
 * and holds the connection to the app; later ones (an agent's stdio copy) join
 * it as peers and forward through it. If the hub exits, a peer takes over.
 * A copy that finds another app's bridge on its port stops and says so; apps
 * never share a bridge.
 *
 * Every command an agent runs goes through the app's command registry, so it
 * is validated, logged and undoable like a person's action.
 *
 * Flags: --hub         run without the MCP side (what `npm run dev` starts).
 *        --home <dir>  the app's folder (default: where this was started).
 * Env:   BRIDGE_PORT (default: "werkbank": { "bridgePort" } in the app's package.json, else 8787), BRIDGE_ORIGINS (comma-separated; default any
 *        http://localhost or http://127.0.0.1 origin), BRIDGE_AGENT (claude).
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WebSocket, WebSocketServer } from "ws";
import { agents, availableAgents, mcpUrl } from "./agents.js";
import { createMcpServer } from "./mcp.js";
import { flag, homeAt, homeId, portOf } from "./config.js";
import { homeOf } from "./home.js";
import { outbound } from "./outbound.js";

/** The app this bridge belongs to: its folder, and the port that goes with it. */
const HOME = homeAt(flag("--home"));
const HOME_ID = homeId(HOME);
const PORT = portOf(HOME);
const ALLOWED = process.env.BRIDGE_ORIGINS?.split(",").map((o) => o.trim());
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const TIMEOUT_MS = 120_000; // long enough for a person to answer an approval prompt
const HUB_ONLY = process.argv.includes("--hub");
const AGENT = process.env.BRIDGE_AGENT ?? "claude";
/** Set for a copy started by a chat agent: the app tab that conversation belongs to. */
const OWN_APP = process.env.BRIDGE_APP || undefined;
const log = (...args) => console.error("[bridge]", ...args); // stdout belongs to MCP
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const NO_APP = {
  ok: false,
  code: "unavailable",
  error:
    `No app is connected to the bridge on port ${PORT}. Open the app in a browser. It connects by itself ` +
    `unless "agent" has been switched off in its status bar (bottom right).`,
};

/** How this process reaches the app: set by whichever role it currently has. */
let ask = async () => NO_APP;
/** Resolves once this process knows its role, so early requests are not lost. */
let settle = () => {};
let settled = new Promise((resolve) => (settle = resolve));
const request = async (method, params, onProgress) => (await settled, ask(method, params, onProgress));
/** Listeners for "something changed in the app", fed by whichever role this process has. */
const noticeListeners = new Set();
const notice = (changed) => noticeListeners.forEach((listener) => listener(changed));

// ---- hub: owns the port and the app connection ------------------------------

function startHub(wss, http) {
  /**
   * Every open tab of the app is a connection. A request goes to the tab it
   * names (a chat agent is tied to the tab that started it), otherwise to the
   * tab the person used most recently.
   * @type {Map<string, { socket: WebSocket, title: string, active: number }>}
   */
  const apps = new Map();
  let nextApp = 1;
  let nextId = 1;
  /** @type {Map<number, { resolve: (v: unknown) => void, timer: NodeJS.Timeout, appId: string, onProgress?: (message: string) => void }>} */
  const pending = new Map();
  /** Other copies of the bridge, each optionally tied to one app tab. @type {Map<WebSocket, string | undefined>} */
  const peers = new Map();
  /** Pass on what changed in an app tab to every agent that is looking at that tab. */
  /** MCP sessions over HTTP, each optionally tied to one app tab. @type {Map<string, { transport: any, appId?: string, listeners: Set<(changed: string[]) => void> }>} */
  const sessions = new Map();
  const announce = (appId, changed) => {
    const active = pick()?.[0] === appId;
    if (OWN_APP ? OWN_APP === appId : active) notice(changed);
    for (const session of sessions.values()) {
      if (session.appId ? session.appId === appId : active) session.listeners.forEach((listener) => listener(changed));
    }
    for (const [socket, boundTo] of peers) {
      if ((boundTo ? boundTo === appId : active) && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ notice: changed }));
    }
  };
  /** @type {Map<string, import("node:child_process").ChildProcess>} */
  const turns = new Map();

  const pick = (appId) => {
    const named = appId ? apps.get(appId) : undefined;
    if (named) return [appId, named];
    if (appId) return null; // the tab this agent belongs to is gone; do not act on another one
    let best = null;
    for (const entry of apps) if (!best || entry[1].active > best[1].active) best = entry;
    return best;
  };

  const toApp = (method, params, appId, onProgress) => {
    const target = pick(appId);
    if (!target) return Promise.resolve(appId ? { ...NO_APP, error: "The app tab this conversation belongs to was closed." } : NO_APP);
    const [targetId, app] = target;
    const id = nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, code: "failed", error: "The app did not answer in time." });
      }, TIMEOUT_MS);
      pending.set(id, { resolve, timer, appId: targetId, onProgress });
      app.socket.send(JSON.stringify({ id, method, params }));
    });
  };
  ask = (method, params, onProgress) => toApp(method, params, OWN_APP, onProgress);

  const sendChat = (socket, id, event) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ chat: { id, event } }));
  };

  /** Run the configured agent for one chat turn and stream its events to the app. */
  function runTurn(socket, appId, { id, text, sessionId, agent }) {
    const adapter = agents[agent ?? AGENT];
    if (!adapter) return sendChat(socket, id, { type: "done", error: `Unknown agent "${agent ?? AGENT}". Known: ${Object.keys(agents).join(", ")}.` });
    const { command, args, env, cwd, stdin } = adapter.start({ sessionId, port: PORT, title: apps.get(appId)?.title ?? "the app", appId, text });
    let child;
    try {
      child = spawn(command, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      return sendChat(socket, id, { type: "done", error: `Could not start ${adapter.label}: ${error.message}` });
    }
    turns.set(id, child);
    child.appId = appId;
    log(`chat turn ${id.slice(0, 8)}: started ${adapter.label} for app tab ${appId}`);
    let finished = false;
    let buffer = "";
    let stderr = "";
    // Text arrives a few characters at a time. Pieces that land within the same
    // 40 ms go out as one message, which keeps the page smooth without visible lag.
    let held = "";
    let flushTimer = null;
    const flush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      if (held) sendChat(socket, id, { type: "delta", text: held });
      held = "";
    };
    const forward = (event) => {
      if (event.type === "delta") {
        held += event.text;
        flushTimer ??= setTimeout(flush, 40);
        return;
      }
      flush(); // keep everything in the order it happened
      sendChat(socket, id, event);
    };
    const finish = (event) => {
      if (finished) return;
      finished = true;
      turns.delete(id);
      flush();
      sendChat(socket, id, event);
    };
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        for (const event of adapter.parse(line)) (event.type === "done" ? finish : forward)(event);
      }
    });
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-600)));
    child.on("error", (error) =>
      finish({
        type: "done",
        error: error.code === "ENOENT" ? `${adapter.label} is not installed or not on the PATH ("${command}").` : error.message,
      }),
    );
    child.on("close", (code, signal) => {
      if (signal) finish({ type: "done", error: "Stopped." });
      else if (code !== 0) finish({ type: "done", error: `${adapter.label} exited with code ${code}. ${stderr.trim()}`.trim() });
      else finish({ type: "done" });
    });
    // Most agents read the message from stdin; an adapter that passes it as an argument sends nothing here.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin ?? text);
  }

  // ---- MCP over HTTP: for any agent that connects by URL -------------------------

  const HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  http.on("request", async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? HOSTS[0]}`);
    // A web page must never drive this endpoint: refuse anything that names a non-local origin.
    const origin = req.headers.origin;
    if (origin && !(ALLOWED ? ALLOWED.includes(origin) : LOCAL.test(origin))) return void res.writeHead(403).end("Forbidden");
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      // `home` names the app's folder without revealing it, so another copy can tell whether it serves the same app.
      return void res.end(JSON.stringify({ name: "werkbank-bridge", version: VERSION, apps: [...apps.values()].map((a) => a.title), mcp: mcpUrl(PORT), home: HOME_ID }));
    }
    if (url.pathname !== "/mcp") return void res.writeHead(404).end("Not found");
    try {
      const sessionId = req.headers["mcp-session-id"];
      let session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
      if (!session) {
        if (sessionId) return void res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unknown MCP session. Reconnect." }, id: null }));
        const appId = url.searchParams.get("app") || undefined;
        const created = { transport: null, appId, listeners: new Set() };
        created.transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableDnsRebindingProtection: true,
          allowedHosts: HOSTS,
          onsessioninitialized: (newId) => {
            sessions.set(newId, created);
            log(`MCP client connected over HTTP${appId ? ` for app tab ${appId}` : ""} (${sessions.size} sessions)`);
          },
        });
        created.transport.onclose = () => {
          for (const [key, value] of sessions) if (value === created) sessions.delete(key);
        };
        const mcp = createMcpServer({
          request: (method, params, onProgress) => toApp(method, params, appId, onProgress),
          onNotice: (listener) => created.listeners.add(listener),
          version: VERSION,
        });
        await mcp.connect(created.transport);
        session = created;
      }
      await session.transport.handleRequest(req, res);
    } catch (error) {
      log(`MCP over HTTP failed: ${error.message}`);
      if (!res.headersSent) res.writeHead(500).end("Internal error");
    }
  });

  wss.on("connection", (socket, request) => {
    // Another copy of the bridge, forwarding an agent's requests.
    if (request.url === "/peer") {
      peers.set(socket, undefined);
      socket.on("message", async (data) => {
        const message = parse(data);
        if (!message) return;
        if (message.bind !== undefined) return void peers.set(socket, message.bind || undefined);
        const send = (payload) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ id: message.id, ...payload }));
        send({ result: await toApp(message.method, message.params, message.app, (progress) => send({ progress })) });
      });
      socket.on("close", () => peers.delete(socket));
      return;
    }

    // A tab of the app.
    const appId = String(nextApp++);
    // The app's own folder, if its dev server vouched for one. Files and secrets are only ever taken from there.
    const app = { socket, title: "the app", active: Date.now(), home: homeOf(request, HOME) };
    apps.set(appId, app);
    socket.send(
      JSON.stringify({
        welcome: {
          version: VERSION,
          // Everything the app needs to tell a person how to connect an agent of their own.
          mcp: { url: mcpUrl(PORT), stdio: { command: "node", args: [fileURLToPath(import.meta.url)] }, port: PORT },
          agents: availableAgents().filter((a) => a.id !== "fake" || AGENT === "fake"),
          defaultAgent: AGENT,
          // Whether this app may keep files and use secrets here; the details come from the "home.info" service.
          home: Boolean(app.home),
          // True when the page came through a dev server of another folder: an app that was pointed at this app's bridge.
          foreign: !app.home && typeof request.headers["x-werkbank-home"] === "string",
        },
      }),
    );
    socket.on("message", (data) => {
      const message = parse(data);
      if (!message) return;
      if (message.hello) {
        app.title = message.hello.title ?? app.title;
        announce(appId, ["app"]);
        return log(`app tab ${appId} connected: ${app.title} (${apps.size} open)`);
      }
      if (message.active) {
        app.active = Date.now();
        return announce(appId, ["app"]); // an unbound agent now looks at this tab
      }
      if (message.changed) return announce(appId, message.changed);
      if (message.progress !== undefined) return void pending.get(message.id)?.onProgress?.(message.progress);
      if (message.chat) return runTurn(socket, appId, message.chat);
      // The app asks the bridge to reach something a page cannot: an API, or another MCP server.
      if (message.service) {
        const { id, name, params } = message.service;
        return void outbound(name, params, { home: app.home }).then((result) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ service: { id, result } })));
      }
      if (message.chatStop) return void turns.get(message.chatStop.id)?.kill("SIGTERM");
      const waiting = pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.delete(message.id);
      waiting.resolve(message.result);
    });
    socket.on("close", () => {
      apps.delete(appId);
      log(`app tab ${appId} disconnected (${apps.size} open)`);
      for (const [id, waiting] of pending) {
        if (waiting.appId !== appId) continue;
        clearTimeout(waiting.timer);
        waiting.resolve({ ok: false, code: "failed", error: "The app tab was closed before answering." });
        pending.delete(id);
      }
      for (const child of turns.values()) if (child.appId === appId) child.kill("SIGTERM");
      notice(["app"]);
      for (const peer of peers.keys()) if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ notice: ["app"] }));
    });
  });

  process.on("exit", () => turns.forEach((child) => child.kill("SIGTERM")));
  settle();
  log(`hub: the bridge of ${HOME}; app and agents connect on port ${PORT}; MCP over HTTP at ${mcpUrl(PORT)} (default chat agent: ${agents[AGENT]?.label ?? AGENT})`);
}

// ---- peer: forwards through the hub that already owns the port --------------

/** Something else has the port. Join it if it is this app's bridge; otherwise stop, because apps do not share one. */
async function startPeer() {
  let other = null;
  try {
    other = await (await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(3000) })).json();
  } catch {
    /* not a bridge, or one that is just going away */
  }
  if (other?.name !== "werkbank-bridge") {
    // A bridge that is shutting down frees the port in a moment; anything else never will.
    if (++attempts <= 6) return void setTimeout(connect, 500);
    log(`port ${PORT} is used by another program. Free it, or give this app another port: "werkbank": { "bridgePort": <number> } in its package.json.`);
    return process.exit(1);
  }
  if (other.home !== HOME_ID) {
    log(
      `port ${PORT} is used by the bridge of another Werkbank app${other.home ? "" : ` (version ${other.version}, from before each app had its own)`}. ` +
        `Apps do not share a bridge: it holds an app's files and secrets. Give this app its own port: "werkbank": { "bridgePort": <number> } in ${HOME}/package.json, then start it again.`,
    );
    return process.exit(1);
  }
  attempts = 0;
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/peer`);
  let nextId = 1;
  const pending = new Map();
  socket.on("open", () => {
    log(`peer: forwarding through the bridge on port ${PORT}`);
    socket.send(JSON.stringify({ bind: OWN_APP ?? "" }));
    ask = (method, params, onProgress) =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, { resolve, onProgress });
        socket.send(JSON.stringify({ id, method, params, ...(OWN_APP ? { app: OWN_APP } : {}) }));
      });
    settle();
  });
  socket.on("message", (data) => {
    const message = parse(data);
    if (!message) return;
    if (message.notice) return notice(message.notice);
    const waiting = pending.get(message.id);
    if (!waiting) return;
    if (message.progress !== undefined) return void waiting.onProgress?.(message.progress);
    pending.delete(message.id);
    waiting.resolve(message.result);
  });
  const lost = () => {
    ask = async () => NO_APP;
    pending.forEach(({ resolve }) => resolve({ ok: false, code: "failed", error: "The bridge went away before answering." }));
    pending.clear();
    settled = new Promise((resolve) => (settle = resolve));
    setTimeout(connect, 500); // the hub is gone: take over, or join whoever did
  };
  socket.on("close", lost);
  socket.on("error", () => {}); // "close" follows and handles it
}

let attempts = 0;

function connect() {
  // One port serves the app's WebSocket, other bridge copies, and MCP over HTTP.
  const http = createServer();
  const wss = new WebSocketServer({
    server: http,
    // The app must be a page served from this machine. Peers are local
    // processes, which (unlike browsers) send no Origin header.
    verifyClient: ({ origin, req }) =>
      req.url === "/peer" ? origin === undefined : ALLOWED ? ALLOWED.includes(origin) : LOCAL.test(origin ?? ""),
  });
  wss.on("error", () => {}); // the HTTP server reports listen errors
  http.on("error", (error) => {
    if (error.code === "EADDRINUSE") return startPeer();
    log(`cannot listen on port ${PORT}: ${error.message}`);
    process.exit(1);
  });
  http.listen(PORT, "127.0.0.1", () => ((attempts = 0), startHub(wss, http)));
}

const parse = (data) => {
  try {
    return JSON.parse(String(data));
  } catch {
    return null;
  }
};

connect();

// ---- MCP side ---------------------------------------------------------------

if (!HUB_ONLY) {
  const mcp = createMcpServer({ request, onNotice: (listener) => noticeListeners.add(listener), version: VERSION });
  await mcp.connect(new StdioServerTransport());
  // When the agent that started this copy goes away, so does the copy.
  process.stdin.on("close", () => process.exit(0));
}
