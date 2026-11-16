/**
 * Agent adapters for the in-app chat. An adapter says how to start an agent
 * for one chat turn and how to read its output. The agent gets the user's
 * message on stdin and is connected to the app through this bridge's MCP
 * server, so everything it does goes through the app's command registry.
 *
 * To add another agent: add an entry here with `bin`, `start` and `parse`. It
 * then appears in the app's assistant settings if its program is installed.
 * BRIDGE_AGENT sets which one is used when the app does not choose.
 *
 * Events an adapter may emit for the app's chat panel:
 *   { type: "session", sessionId }        id to resume the conversation with
 *   { type: "delta", text }               the next piece of what the agent is saying, as it is written
 *   { type: "text", text }                a finished passage (replaces the deltas that built it)
 *   { type: "status", text }              what the agent is doing right now, e.g. "thinking"
 *   { type: "tool", name, input }         a tool call it made
 *   { type: "tool_result", ok, summary }  how that call went
 *   { type: "done", error?, costUsd? }    the turn is over (the bridge adds one if the adapter does not)
 */
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const TOOL_PREFIX = "mcp__werkbank__";

const SYSTEM = (title) =>
  [
    `You are the assistant inside the app "${title}". The user is looking at it right now and typed their message into its chat panel.`,
    `You can see and operate the app only through the Werkbank tools. werkbank_describe returns a short summary; pass panel ids to get the data behind those panels. werkbank_commands finds commands and their input schemas. werkbank_run runs one command, werkbank_batch several in order. If the user wants a panel of their own, build it as a custom element: werkbank_element_guide, then werkbank_save_element.`,
    `Read before you act, and read only the panels the question is about. Answer questions about what is on screen from the panel data, quoting its numbers exactly. When asked to change something, do it and then say briefly what you did.`,
    `Some commands need the user's approval in the app; if one is denied, do not retry it. Keep replies short: the chat panel is narrow. Markdown is rendered, but avoid wide tables.`,
  ].join(" ");

/** Where an agent started for one app tab reaches this bridge over MCP. */
export const mcpUrl = (port, appId) => `http://127.0.0.1:${port}/mcp${appId ? `?app=${encodeURIComponent(appId)}` : ""}`;

/** Environment for a child agent: drop the variables that mark a nested Claude Code session. */
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "CLAUDECODE" || key === "CLAUDE_PID" || key === "CLAUDE_EFFORT" || key.startsWith("CLAUDE_CODE_")) delete env[key];
  }
  return env;
}

const brief = (value, max = 160) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export const agents = {
  /** Claude Code in headless mode, limited to the Werkbank tools. */
  claude: {
    label: "Claude Code",
    bin: process.env.BRIDGE_CLAUDE_BIN ?? "claude",
    start: ({ sessionId, port, title, appId }) => ({
      command: process.env.BRIDGE_CLAUDE_BIN ?? "claude",
      args: [
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        // Token-level events, so the reply can be shown while it is being written.
        "--include-partial-messages",
        "--mcp-config", JSON.stringify({ mcpServers: { werkbank: { type: "http", url: mcpUrl(port, appId) } } }),
        "--strict-mcp-config",
        // No file, shell or web access: the agent can only use the app's own commands.
        "--tools", "",
        "--allowedTools", ["describe", "commands", "run", "batch", "element_guide", "save_element"].map((t) => `${TOOL_PREFIX}werkbank_${t}`).join(","),
        "--append-system-prompt", SYSTEM(title),
        // The model is the agent's own setting. BRIDGE_AGENT_MODEL overrides it for everything this bridge starts.
        ...(process.env.BRIDGE_AGENT_MODEL ? ["--model", process.env.BRIDGE_AGENT_MODEL] : []),
        ...(sessionId ? ["--resume", sessionId] : []),
      ],
      env: cleanEnv(),
    }),
    /** One line of `--output-format stream-json` to chat events. */
    parse(line) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return [];
      }
      const events = [];
      if (message.type === "system" && message.subtype === "init" && message.session_id) {
        events.push({ type: "session", sessionId: message.session_id });
      } else if (message.type === "stream_event") {
        const event = message.event ?? {};
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          events.push({ type: "delta", text: event.delta.text });
        } else if (event.type === "content_block_start") {
          const block = event.content_block ?? {};
          if (block.type === "thinking") events.push({ type: "status", text: "thinking" });
          if (block.type === "tool_use") events.push({ type: "status", text: `calling ${block.name.replace(TOOL_PREFIX, "")}` });
        } else if (event.type === "message_start") {
          events.push({ type: "status", text: "working" });
        }
      } else if (message.type === "assistant") {
        for (const block of message.message?.content ?? []) {
          if (block.type === "text" && block.text.trim()) events.push({ type: "text", text: block.text });
          if (block.type === "tool_use") events.push({ type: "tool", name: block.name.replace(TOOL_PREFIX, ""), input: block.input });
        }
      } else if (message.type === "user") {
        for (const block of message.message?.content ?? []) {
          if (block.type !== "tool_result") continue;
          const text = Array.isArray(block.content) ? block.content.map((c) => c.text ?? "").join(" ") : block.content;
          events.push({ type: "tool_result", ok: !block.is_error, summary: brief(text ?? "") });
          events.push({ type: "status", text: "reading the result" });
        }
      } else if (message.type === "result") {
        if (message.session_id) events.push({ type: "session", sessionId: message.session_id });
        events.push({
          type: "done",
          ...(message.is_error ? { error: brief(message.result ?? message.subtype ?? "The agent reported an error.", 400) } : {}),
          ...(typeof message.total_cost_usd === "number" ? { costUsd: message.total_cost_usd } : {}),
        });
      }
      return events;
    },
  },

  /**
   * OpenAI Codex in headless mode, read-only sandbox, with the app as its one MCP server.
   *
   * Written against Codex's documented `exec --json` event stream. Start-up and
   * the failure events are exercised; see docs/design.md for what could not be
   * verified on the development machine.
   */
  codex: {
    label: "Codex",
    bin: process.env.BRIDGE_CODEX_BIN ?? "codex",
    start: ({ sessionId, port, title, appId, text }) => ({
      command: process.env.BRIDGE_CODEX_BIN ?? "codex",
      args: [
        "exec",
        ...(sessionId ? ["resume", sessionId] : []),
        "--json",
        "--skip-git-repo-check",
        // The agent's reach is the app's commands; it has no business writing files or running a shell.
        ...(sessionId ? [] : ["-s", "read-only"]),
        "-c", `mcp_servers.werkbank.url="${mcpUrl(port, appId)}"`,
        "-c", 'approval_policy="never"',
        ...(process.env.BRIDGE_AGENT_MODEL ? ["-m", process.env.BRIDGE_AGENT_MODEL] : []),
        // Codex has no separate system-prompt flag in exec mode, so the briefing leads the first message.
        sessionId ? text : `${SYSTEM(title)}\n\nThe user's message:\n${text}`,
      ],
      env: process.env,
      cwd: tmpdir(),
      stdin: "",
    }),
    parse(line) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return [];
      }
      const out = [];
      if (event.type === "thread.started" && event.thread_id) out.push({ type: "session", sessionId: event.thread_id });
      else if (event.type === "turn.started") out.push({ type: "status", text: "working" });
      else if (event.type === "item.started" && event.item?.type === "mcp_tool_call") {
        out.push({ type: "tool", name: String(event.item.tool ?? "tool"), input: event.item.arguments ?? {} });
      } else if (event.type === "item.started" && event.item?.type === "reasoning") out.push({ type: "status", text: "thinking" });
      else if (event.type === "item.completed") {
        const item = event.item ?? {};
        if (item.type === "agent_message" && item.text) out.push({ type: "text", text: item.text });
        else if (item.type === "mcp_tool_call") out.push({ type: "tool_result", ok: item.status !== "failed" && !item.error, summary: brief(item.error?.message ?? item.result ?? "") });
        // Start-up notices about the account's configuration arrive as error items; they are not failures of the turn.
      } else if (event.type === "turn.completed") out.push({ type: "done" });
      else if (event.type === "turn.failed") out.push({ type: "done", error: brief(event.error?.message ?? "Codex could not complete the turn.", 400) });
      return out;
    },
  },

  /**
   * A scripted stand-in used by the automated checks. It goes through the same
   * MCP path as a real agent but costs nothing and needs no account.
   */
  fake: {
    label: "Scripted test agent",
    bin: process.execPath,
    start: ({ sessionId, port, appId }) => ({
      command: process.execPath,
      args: [fileURLToPath(new URL("./fake-agent.js", import.meta.url)), String(port), sessionId ?? ""],
      env: { ...process.env, BRIDGE_APP: String(appId ?? "") },
    }),
    parse(line) {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    },
  },
};

/** Which agents can actually be started on this machine. Checked once. */
let detected = null;
export function availableAgents() {
  detected ??= Object.entries(agents).map(([id, adapter]) => ({
    id,
    label: adapter.label,
    available: spawnSync(adapter.bin, ["--version"], { stdio: "ignore", timeout: 8000 }).status === 0,
  }));
  return detected;
}
