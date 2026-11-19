import { ELEMENT_API, type AssistantInfo, type HomeInfo, type Werkbank } from "./core";

/** What the chat agent reports while it works on one message. */
export type ChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "delta"; text: string }
  | { type: "text"; text: string }
  | { type: "status"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "tool_result"; ok: boolean; summary: string }
  | { type: "done"; error?: string; costUsd?: number };

type ChatListener = (event: ChatEvent) => void;
export type ServiceResult = { ok: true; value: unknown } | { ok: false; error: string; code?: string };

/** Parameters of the requests the bridge can make. Each method uses the fields it needs. */
interface RequestParams {
  id?: string;
  input?: unknown;
  panels?: string[];
  detail?: "summary" | "full";
  ids?: string[];
  query?: string;
  schemas?: boolean;
  steps?: { id: string; input?: unknown }[];
  what?: string;
}

/**
 * The app's end of the agent bridge. The bridge sends requests (describe,
 * commands, run), which run through the command registry with actor "agent".
 * The app can also ask the bridge to start an agent for one chat message.
 */
export class AgentLink {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private delay = 1000;
  private turns = new Map<string, ChatListener>();
  private services = new Map<string, (result: ServiceResult) => void>();
  private unwatch: () => void = () => {};
  private unwatchSettings: () => void = () => {};
  constructor(
    private wb: Werkbank,
    private url: string,
  ) {
    this.open();
    this.unwatch = this.watch();
    // Switching "keep conversations in the app's folder" takes effect at once.
    const choices = () => `${wb.settings.get<boolean>("assistant.conversationsOnDisk")} ${wb.settings.get<boolean>("storage.onDisk")}`;
    let onDisk = choices();
    this.unwatchSettings = wb.settings.subscribe(() => {
      const next = choices();
      if (next === onDisk) return;
      onDisk = next;
      void this.refreshHome();
    });
    window.addEventListener("focus", this.reportActive);
    window.addEventListener("pagehide", this.flushFiles);
    document.addEventListener("visibilitychange", this.reportActive);
  }

  /** Several tabs can be connected; an agent without a tab of its own acts on the one in use. */
  private reportActive = (): void => {
    if (document.visibilityState === "visible" && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ active: true }));
    }
  };

  private open(): void {
    if (this.stopped) return;
    const { wb } = this;
    wb.setMeta({ bridge: "connecting" });
    const socket = (this.socket = new WebSocket(this.url));
    socket.onopen = () => {
      this.delay = 1000;
      wb.setMeta({ bridge: "connected" });
      socket.send(JSON.stringify({ hello: { appId: wb.config.appId, title: wb.config.title } }));
      if (document.hasFocus()) this.reportActive();
    };
    socket.onmessage = async (event) => {
      let message: {
        id?: number;
        method?: string;
        params?: RequestParams;
        welcome?: AssistantInfo;
        chat?: { id: string; event: ChatEvent };
        service?: { id: string; result: ServiceResult };
      };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.welcome) {
        wb.setMeta({ assistant: message.welcome });
        return void this.useHome(message.welcome.home === true);
      }
      if (message.service) {
        const resolve = this.services.get(message.service.id);
        this.services.delete(message.service.id);
        return resolve?.(message.service.result);
      }
      if (message.chat) {
        const listener = this.turns.get(message.chat.id);
        if (message.chat.event.type === "done") this.turns.delete(message.chat.id);
        return listener?.(message.chat.event);
      }
      const result = await this.answer(message.method ?? "", message.params ?? {}, message.id);
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: message.id, result }));
    };
    socket.onclose = () => {
      this.failTurns("The connection to the bridge was lost.");
      wb.conversations.detach();
      wb.files.detach();
      if (this.stopped) return;
      wb.setMeta({ bridge: "connecting", home: null });
      this.timer = setTimeout(() => this.open(), this.delay);
      this.delay = Math.min(this.delay * 2, 10_000);
    };
  }

  /** Handle one request from the bridge. Everything an agent does to the app comes through here. */
  private async answer(method: string, params: RequestParams, requestId?: number): Promise<unknown> {
    const { wb } = this;
    try {
      if (method === "describe") return { ok: true, value: wb.describe({ panels: params.panels, detail: params.detail }) };
      if (method === "commands") return { ok: true, value: wb.commands.describe(wb, { ids: params.ids, query: params.query, schemas: params.schemas }) };
      if (method === "run") return await this.run(params.id ?? "", params, requestId);
      if (method === "batch") {
        // Steps run in order and stop at the first failure, so a later step never acts on a state the earlier one did not reach.
        const results: unknown[] = [];
        for (const step of params.steps ?? []) {
          const result = await this.run(step.id, { input: step.input }, requestId);
          results.push({ id: step.id, ...result });
          if (!result.ok) break;
        }
        const done = results.length === (params.steps ?? []).length && results.every((r) => (r as { ok: boolean }).ok);
        return { ok: true, value: { completed: done, stepsRun: results.length, stepsGiven: (params.steps ?? []).length, results } };
      }
      if (method === "elements") {
        // Everything an agent needs to write a custom element for this app.
        const summary = wb.describe({ detail: "summary" }) as { panels: { id: string; tool: string; title: string }[] };
        return {
          ok: true,
          value: {
            api: ELEMENT_API,
            hostFunctions: Object.entries(wb.config.custom?.hostFunctions ?? {}).map(([name, f]) => ({ name, description: f.description })),
            libraries: Object.entries(wb.config.custom?.libraries ?? {}).map(([name, l]) => ({ name, tag: `<script src="lib:${name}"></script>`, global: l.global, title: l.title, description: l.description })),
            topics: Object.keys(wb.config.topics ?? {}),
            openPanels: summary.panels.map(({ id, tool, title }) => ({ id, tool, title })),
            elements: wb.custom.list().map(({ id, title, description, status, revision }) => ({ id, title, description, status, revision })),
            ...(params.id ? { element: wb.custom.get(params.id) ?? null } : {}),
          },
        };
      }
      if (method === "read") {
        if (params.what === "workspace") return { ok: true, value: (wb.syncLayout(), wb.getDoc()) };
        if (params.what === "history") return { ok: true, value: wb.history() };
        return { ok: false, code: "unknown", error: `Nothing to read called "${params.what}".` };
      }
      return { ok: false, code: "unknown", error: `Unknown method: ${method}` };
    } catch (error) {
      return { ok: false, code: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Run a command as the agent, reporting to the bridge if it stops to wait for the person's approval. */
  private async run(id: string, params: { input?: unknown }, requestId?: number) {
    const stop = this.wb.subscribeMeta(() => {
      if (this.wb.getMeta().pendingApproval?.commandId !== id || requestId === undefined) return;
      stop();
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ id: requestId, progress: `Waiting for the person to approve "${this.wb.getMeta().pendingApproval!.title}" in the app.` }));
      }
    });
    try {
      return await this.wb.run(id, params.input, "agent");
    } finally {
      stop();
    }
  }

  /**
   * Tell the bridge what changed, so agents that subscribed to a resource hear
   * about it. Live data ticks are not reported: only the workspace, panel
   * state and the action history.
   */
  private watch(): () => void {
    let doc = this.wb.getDoc();
    let logLength = this.wb.getMeta().log.length;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();
    const flush = () => {
      timer = null;
      if (pending.size && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ changed: [...pending] }));
      pending.clear();
    };
    const note = (what: string) => {
      pending.add(what);
      timer ??= setTimeout(flush, 400);
    };
    const offDoc = this.wb.subscribeDoc(() => {
      const next = this.wb.getDoc();
      const ids = new Set([...Object.keys(doc.instances), ...Object.keys(next.instances)]);
      const before = Object.keys(doc.instances).length;
      for (const id of ids) {
        if (doc.instances[id] === next.instances[id]) continue;
        // A change to a link group's value changes what every panel in the group shows.
        note(`panel:${id}`);
      }
      if (doc.links !== next.links) for (const [id, inst] of Object.entries(next.instances)) if (inst.link && doc.links[inst.link] !== next.links[inst.link]) note(`panel:${id}`);
      if (before !== Object.keys(next.instances).length || [...ids].some((id) => !doc.instances[id] || !next.instances[id])) note("panels");
      note("workspace");
      doc = next;
    });
    const offMeta = this.wb.subscribeMeta(() => {
      const length = this.wb.getMeta().log.length;
      if (length !== logLength) note("history");
      logLength = length;
    });
    return () => {
      offDoc();
      offMeta();
      if (timer) clearTimeout(timer);
    };
  }

  /**
   * The app's folder on this machine, if the bridge was told one: ask what is there (the names of
   * the secrets, never their values) and keep the conversations in a file there as well.
   */
  private async useHome(offered: boolean): Promise<void> {
    const wb = this.wb;
    const info = offered ? await this.service("home.info", {}) : null;
    const home = info?.ok ? (info.value as HomeInfo) : null;
    wb.setMeta({ home });
    const socket = this.socket;
    const usable = Boolean(home?.store) && this.socket === socket;
    const call = async (name: string, params: object) => {
      const result = await this.service(name, params);
      if (!result.ok) throw new Error(result.error);
      return result.value;
    };
    const file = (name: string) => ({
      read: async () => ((await call("store.read", { name })) as { text: string | null }).text,
      write: async (text: string) => void (await call("store.write", { name, text })),
    });
    if (usable && wb.settings.get<boolean>("assistant.conversationsOnDisk")) void wb.conversations.attach(file("conversations"));
    else wb.conversations.detach();
    if (!(usable && wb.settings.get<boolean>("storage.onDisk"))) return wb.files.detach();
    const replaced = await wb.files.attach(file("data"));
    // Only the first look at the folder may start the page again; later the person is at work in it.
    const first = !this.restored;
    this.restored = true;
    if (!replaced.length) return;
    // The app's folder held newer workspaces or settings than this browser. The running app has not read them.
    if (wb.files.startedEmpty && first) {
      // A browser that knew nothing of the app (new, or its data was cleared): start again with what was kept, before the person has done anything.
      try {
        if (sessionStorage.getItem("werkbank.restored") !== wb.config.appId) {
          sessionStorage.setItem("werkbank.restored", wb.config.appId);
          return location.reload();
        }
      } catch {
        /* no session storage: fall through to the notice */
      }
    }
    const note = "Newer workspaces or settings were found in the app's folder. Reload the page to use them.";
    if (!wb.getMeta().notes.includes(note)) wb.setMeta({ notes: [...wb.getMeta().notes, note] });
  }
  private restored = false;

  /** Ask the bridge again what the app's folder holds, for example after the person edited `.env`. */
  refreshHome(): Promise<void> {
    return this.useHome(this.wb.getMeta().assistant?.home === true);
  }

  private flushFiles = (): void => this.wb.files.flush();

  private failTurns(error: string): void {
    const listeners = [...this.turns.values()];
    this.turns.clear();
    listeners.forEach((listener) => listener({ type: "done", error }));
    const waiting = [...this.services.values()];
    this.services.clear();
    waiting.forEach((resolve) => resolve({ ok: false, error }));
  }

  /**
   * Ask the bridge to do something a browser page cannot: fetch from an API
   * ("http.get") or talk to another MCP server ("mcp.tools", "mcp.call").
   * The bridge is the app's local backend for these.
   */
  service(name: string, params: object): Promise<ServiceResult> {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, error: "The agent bridge is not connected." });
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      this.services.set(id, resolve);
      this.socket!.send(JSON.stringify({ service: { id, name, params } }));
    });
  }

  /** Send one chat message to the agent. Events arrive until one of type "done". */
  chat(text: string, sessionId: string | null, onEvent: ChatListener, options: { agent?: string | null } = {}): { stop: () => void } {
    const id = crypto.randomUUID();
    if (this.socket?.readyState !== WebSocket.OPEN) {
      onEvent({ type: "done", error: "The bridge is not connected." });
      return { stop: () => {} };
    }
    this.turns.set(id, onEvent);
    this.socket.send(
      JSON.stringify({ chat: { id, text, ...(sessionId ? { sessionId } : {}), ...(options.agent ? { agent: options.agent } : {}) } }),
    );
    return { stop: () => this.socket?.readyState === WebSocket.OPEN && this.socket.send(JSON.stringify({ chatStop: { id } })) };
  }

  close(): void {
    this.stopped = true;
    this.unwatch();
    window.removeEventListener("focus", this.reportActive);
    window.removeEventListener("pagehide", this.flushFiles);
    document.removeEventListener("visibilitychange", this.reportActive);
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.unwatchSettings();
    this.wb.conversations.detach();
    this.wb.files.detach();
    this.wb.setMeta({ bridge: "off", assistant: null, home: null });
  }
}

/**
 * The link belonging to a Werkbank instance, while the person has the agent
 * connection switched on. The shell owns it; tools read it through hooks.
 */
const links = new WeakMap<Werkbank, AgentLink>();
const requests = new WeakMap<Werkbank, () => void>();

export const getAgentLink = (wb: Werkbank): AgentLink | undefined => links.get(wb);
export const setAgentLink = (wb: Werkbank, link: AgentLink | null): void => void (link ? links.set(wb, link) : links.delete(wb));

/** Lets a tool (the chat panel) ask the shell to switch the agent connection on. */
export const onConnectRequest = (wb: Werkbank, handler: (() => void) | null): void =>
  void (handler ? requests.set(wb, handler) : requests.delete(wb));
export const requestAgentConnection = (wb: Werkbank): void => requests.get(wb)?.();

/** Call one of the bridge's outbound services for this app. Resolves to a failure if the bridge is not connected. */
export const bridgeService = (wb: Werkbank, name: string, params: object): Promise<ServiceResult> =>
  links.get(wb)?.service(name, params) ?? Promise.resolve({ ok: false, error: "The agent bridge is not connected. Start it with `npm run dev` and switch the connection on in the assistant setup." });
