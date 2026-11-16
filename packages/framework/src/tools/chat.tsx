import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { getAgentLink, requestAgentConnection, type ChatEvent } from "../bridge-client";
import type { Werkbank } from "../core";
import { copyText, openContextMenu } from "../menu";
import { defineTool, useInstanceId, useMeta, useSetting, useToolState, useWerkbank } from "./index";
import { Markdown } from "./Markdown";

/**
 * The assistant panel. It does not talk to a model itself: each message goes
 * to the local agent bridge, which starts the coding agent chosen in the
 * assistant setup (Claude Code, Codex, ...). That agent sees and operates the
 * app through the same commands as everyone else, so what it does shows up in
 * the action history and anything irreversible still needs approval.
 *
 * Conversations are kept as a list, so earlier ones can be reopened.
 */
const messageSchema = z.object({
  role: z.enum(["user", "assistant", "tool", "error"]),
  text: z.string(),
  /** For tool rows: whether the call succeeded, once known. */
  ok: z.boolean().optional(),
  /** True while the agent is still writing this message. */
  streaming: z.boolean().optional(),
});
const conversationSchema = z.object({
  id: z.string(),
  title: z.string().max(80),
  messages: z.array(messageSchema).max(400),
  /** The agent's own conversation id, so follow-up messages keep their context. */
  sessionId: z.string().nullable(),
  /** The agent that session belongs to. A session cannot continue with a different agent. */
  agent: z.string().nullable(),
  updated: z.string(),
});
const stateSchema = z.object({
  conversations: z.array(conversationSchema).max(40),
  active: z.string().nullable(),
  draft: z.string().max(20_000),
  showList: z.boolean(),
});
type State = z.infer<typeof stateSchema>;
type Message = z.infer<typeof messageSchema>;
type Conversation = z.infer<typeof conversationSchema>;

/** Turns in flight, by panel id. They outlive a hidden tab, so they live outside React. */
const running = new Map<string, { stop: () => void; status: string; conversation: string }>();
/** Per conversation: the message index from which text is revealed as it arrives rather than shown at once. */
const liveFrom = new Map<string, number>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));

const compact = (value: unknown) => {
  const text = JSON.stringify(value) ?? "";
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
};
const titleFrom = (text: string) => (text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text);
const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** Wait for the bridge connection, switching it on if the person had it off. */
async function connected(wb: Werkbank): Promise<boolean> {
  if (wb.getMeta().bridge === "off") requestAgentConnection(wb);
  for (let waited = 0; waited < 6000; waited += 100) {
    if (wb.getMeta().bridge === "connected" && getAgentLink(wb)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function send(wb: Werkbank, panelId: string, text: string): Promise<void> {
  // If the workspace is replaced mid-turn (the agent may do that itself), keep writing to the chat panel that took over.
  let target = panelId;
  const read = () => {
    const instances = wb.getDoc().instances;
    if (!instances[target]) target = Object.values(instances).find((i) => i.toolId === "chat")?.id ?? target;
    return instances[target]?.state as State | undefined;
  };
  const write = (change: (state: State) => State) => {
    const state = read();
    if (state) wb.setState(target, change(state));
  };

  // The message goes to the open conversation, or starts a new one.
  const agent = wb.settings.get<string>("assistant.agent") || wb.getMeta().assistant?.defaultAgent || null;
  let conversationId = read()?.active ?? null;
  if (!conversationId || !read()?.conversations.some((c) => c.id === conversationId)) {
    conversationId = crypto.randomUUID();
    const fresh: Conversation = { id: conversationId, title: titleFrom(text), messages: [], sessionId: null, agent, updated: new Date().toISOString() };
    write((s) => ({ ...s, active: fresh.id, conversations: [fresh, ...s.conversations].slice(0, 40) }));
  }
  const id = conversationId;
  const update = (change: (c: Conversation) => Conversation) =>
    write((s) => ({ ...s, conversations: s.conversations.map((c) => (c.id === id ? { ...change(c), updated: new Date().toISOString() } : c)) }));
  const push = (message: Message) => update((c) => ({ ...c, messages: [...c.messages, message].slice(-400) }));
  /** Close off the message being written, optionally replacing it with its final text. */
  const settle = (finalText?: string) =>
    update((c) => {
      const last = c.messages.at(-1);
      if (last?.role !== "assistant" || !last.streaming) {
        return finalText === undefined ? c : { ...c, messages: [...c.messages, { role: "assistant" as const, text: finalText }].slice(-400) };
      }
      return { ...c, messages: [...c.messages.slice(0, -1), { role: "assistant" as const, text: finalText ?? last.text }] };
    });
  const turn = { stop: () => {}, status: "connecting", conversation: id };
  const setStatus = (status: string) => {
    turn.status = status;
    changed();
  };

  const conversation = read()?.conversations.find((c) => c.id === id);
  // A session belongs to the agent that started it; a different agent begins afresh.
  const resume = conversation && conversation.agent === agent ? conversation.sessionId : null;
  push({ role: "user", text });
  update((c) => ({ ...c, agent, ...(resume ? {} : { sessionId: null }), title: c.messages.length <= 1 ? titleFrom(text) : c.title }));
  liveFrom.set(id, read()?.conversations.find((c) => c.id === id)?.messages.length ?? 0);
  running.set(panelId, turn);
  changed();

  if (!(await connected(wb))) {
    running.delete(panelId);
    changed();
    return push({ role: "error", text: "Could not reach the agent bridge. Start it with `npm run dev` (app and bridge together) or `npm run bridge`, then send again." });
  }
  setStatus("starting the agent");

  const onEvent = (event: ChatEvent) => {
    if (event.type === "session") update((c) => ({ ...c, sessionId: event.sessionId }));
    else if (event.type === "status") setStatus(event.text);
    else if (event.type === "delta") {
      setStatus("writing");
      update((c) => {
        const last = c.messages.at(-1);
        return last?.role === "assistant" && last.streaming
          ? { ...c, messages: [...c.messages.slice(0, -1), { ...last, text: last.text + event.text }] }
          : { ...c, messages: [...c.messages, { role: "assistant" as const, text: event.text, streaming: true }].slice(-400) };
      });
    } else if (event.type === "text") settle(event.text);
    else if (event.type === "tool") {
      settle();
      const input = event.input as { id?: string; input?: unknown } | undefined;
      // Show the app command rather than the transport tool where there is one.
      push({ role: "tool", text: event.name.endsWith("werkbank_run") && input?.id ? `${input.id} ${compact(input.input ?? {})}` : event.name.replace(/^.*werkbank_/, "") });
    } else if (event.type === "tool_result") {
      update((c) => {
        const index = c.messages.findLastIndex((m) => m.role === "tool" && m.ok === undefined);
        if (index < 0) return c;
        const messages = [...c.messages];
        messages[index] = { ...messages[index]!, ok: event.ok, ...(event.ok ? {} : { text: `${messages[index]!.text} — ${event.summary}` }) };
        return { ...c, messages };
      });
    } else {
      settle();
      running.delete(panelId);
      if (event.error) push({ role: "error", text: event.error });
      changed();
    }
  };
  turn.stop = getAgentLink(wb)!.chat(text, resume ?? null, onEvent, { agent }).stop;
}

/**
 * Shows text as it arrives. Agents sometimes deliver a whole reply in one
 * burst; rather than a block of text popping in, it is written out over a
 * fraction of a second. Text that streams in steadily is shown as it comes.
 */
function Reveal({ text, live, caret, onGrow, onMenu }: { text: string; live: boolean; caret: boolean; onGrow: () => void; onMenu: (e: React.MouseEvent) => void }) {
  const [shown, setShown] = useState(live ? 0 : text.length);
  useEffect(() => {
    if (shown >= text.length) return;
    const frame = requestAnimationFrame(() => {
      // Never more than about half a second behind what has been received.
      setShown((n) => Math.min(text.length, n + Math.max(2, Math.ceil((text.length - n) / 16))));
      onGrow();
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, text, onGrow]);
  const behind = shown < text.length;
  return (
    <div className="wb-chat-message" data-role="assistant" data-streaming={caret || behind || undefined} onContextMenu={onMenu}>
      <Markdown text={behind ? text.slice(0, shown) : text} />
    </div>
  );
}

function Chat() {
  const wb = useWerkbank();
  const id = useInstanceId();
  const [state, setState] = useToolState<State>();
  const bridge = useMeta((meta) => meta.bridge);
  const info = useMeta((meta) => meta.assistant);
  const [agentSetting] = useSetting<string>("assistant.agent");
  const turn = useSyncExternalStore(subscribe, () => running.get(id));
  const status = useSyncExternalStore(subscribe, () => running.get(id)?.status ?? "");
  const list = useRef<HTMLDivElement>(null);
  const scrollDown = useCallback(() => list.current?.scrollTo({ top: list.current.scrollHeight }), []);

  const conversation = state.conversations.find((c) => c.id === state.active);
  const messages = conversation?.messages ?? [];
  const busy = Boolean(turn);
  const busyHere = turn?.conversation === conversation?.id;
  const live = conversation ? (liveFrom.get(conversation.id) ?? Infinity) : Infinity;
  const lastText = messages.at(-1)?.text.length ?? 0;
  const agentId = agentSetting || info?.defaultAgent || "";
  const agent = info?.agents.find((a) => a.id === agentId);
  const sorted = [...state.conversations].sort((a, b) => b.updated.localeCompare(a.updated));

  useEffect(() => {
    scrollDown();
  }, [messages.length, lastText, busyHere, state.active, scrollDown]);

  const submit = () => {
    const text = state.draft.trim();
    if (!text || busy) return;
    setState({ ...state, draft: "" });
    void send(wb, id, text);
  };
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const rename = () => {
    const title = renaming?.title.trim();
    if (renaming && title) setState({ ...state, conversations: state.conversations.map((c) => (c.id === renaming.id ? { ...c, title: title.slice(0, 80) } : c)) });
    setRenaming(null);
  };
  const remove = (conversationId: string) =>
    setState({ ...state, conversations: state.conversations.filter((c) => c.id !== conversationId), active: state.active === conversationId ? null : state.active });
  const messageMenu = (message: Message) => (e: React.MouseEvent) =>
    openContextMenu(wb, e, [
      { label: "Copy message", run: () => copyText(message.text) },
      message.role === "user" && { label: "Edit and send again", run: () => setState({ ...state, draft: message.text }) },
    ]);

  return (
    <div className="wb-chat">
      <div className="wb-toolhead">
        <button className="wb-button" aria-pressed={state.showList} title="Show or hide your conversations" onClick={() => setState({ ...state, showList: !state.showList })}>
          ☰ Chats ({state.conversations.length})
        </button>
        <strong
          className="wb-chat-title"
          title={conversation ? "Double-click to rename" : undefined}
          onDoubleClick={() => conversation && (setState({ ...state, showList: true }), setRenaming({ id: conversation.id, title: conversation.title }))}
        >
          {conversation?.title ?? "New chat"}
        </strong>
        <span style={{ flex: 1 }} />
        <button
          className="wb-button"
          data-tone={bridge === "connected" && agent?.available ? undefined : "warn"}
          title={
            bridge !== "connected"
              ? "The agent bridge is not connected. Open the setup to see why."
              : `Answered by ${agent?.label ?? agentId}${agent && !agent.available ? ", which is not installed" : ""}. Open the setup to change the agent or connect one of your own.`
          }
          onClick={() => void wb.run("assistant.setup")}
        >
          Setup{bridge !== "connected" ? (bridge === "connecting" ? " (waiting for the bridge)" : " (not connected)") : agent && !agent.available ? " (agent not installed)" : ""}
        </button>
        <button className="wb-button" disabled={busy || !conversation} title="Start a fresh conversation; this one stays in the list" onClick={() => setState({ ...state, active: null })}>
          New chat
        </button>
      </div>
      <div className="wb-chat-body">
        {state.showList && (
          <nav className="wb-chat-overview" aria-label="Conversations">
            {sorted.map((c) => (
              <div
                key={c.id}
                className="wb-chat-overview-item"
                aria-current={c.id === state.active || undefined}
                onContextMenu={(e) =>
                  openContextMenu(wb, e, [
                    { label: "Open", run: () => setState({ ...state, active: c.id }) },
                    { label: "Rename", hint: "double-click", run: () => setRenaming({ id: c.id, title: c.title }) },
                    { label: "Copy as text", run: () => copyText(c.messages.filter((m) => m.role !== "tool").map((m) => `${m.role}: ${m.text}`).join("\n\n")) },
                    { separator: true },
                    { label: "Delete conversation", danger: true, disabled: turn?.conversation === c.id, run: () => remove(c.id) },
                  ])
                }
              >
                {renaming?.id === c.id && (
                  <input
                    className="wb-input wb-chat-rename"
                    autoFocus
                    aria-label="Conversation name"
                    value={renaming.title}
                    maxLength={80}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setRenaming({ id: c.id, title: e.target.value })}
                    onBlur={rename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename();
                      else if (e.key === "Escape") (e.stopPropagation(), setRenaming(null));
                    }}
                  />
                )}
                <button
                  className="wb-chat-overview-open"
                  hidden={renaming?.id === c.id}
                  disabled={busy && turn?.conversation !== c.id}
                  title="Double-click to rename"
                  onClick={() => setState({ ...state, active: c.id })}
                  onDoubleClick={() => setRenaming({ id: c.id, title: c.title })}
                >
                  <span className="wb-chat-overview-title">{c.title}</span>
                  <span className="wb-chat-overview-meta">
                    {ago(c.updated)} · {c.messages.filter((m) => m.role === "user").length} sent{c.agent ? ` · ${info?.agents.find((a) => a.id === c.agent)?.label ?? c.agent}` : ""}
                  </span>
                </button>
                <button className="wb-tool-button" aria-label={`Delete conversation ${c.title}`} title="Delete" disabled={turn?.conversation === c.id} onClick={() => remove(c.id)}>
                  ×
                </button>
              </div>
            ))}
            {sorted.length === 0 && <p className="wb-hint">No conversations yet.</p>}
          </nav>
        )}
        <div className="wb-chat-main">
          <div className="wb-chat-list" ref={list} role="log" aria-label="Conversation">
            {messages.length === 0 && (
              <p className="wb-hint">
                Ask about what is on screen, or ask for a change. The assistant works through this app's own commands, so its actions
                appear in the action history and can be undone. You can also drive the app from a coding agent of your own: see the
                setup button above.
              </p>
            )}
            {messages.map((message, i) =>
              message.role === "tool" ? (
                <div key={i} className="wb-chat-tool" data-ok={message.ok === undefined ? "pending" : String(message.ok)} onContextMenu={messageMenu(message)}>
                  <span aria-hidden>{message.ok === undefined ? "…" : message.ok ? "✓" : "✗"}</span> {message.text}
                </div>
              ) : message.role === "assistant" ? (
                <Reveal key={`${conversation!.id}:${i}`} text={message.text} live={i >= live} caret={Boolean(busyHere && message.streaming)} onGrow={scrollDown} onMenu={messageMenu(message)} />
              ) : (
                <div key={i} className="wb-chat-message" data-role={message.role} onContextMenu={messageMenu(message)}>
                  {message.text}
                </div>
              ),
            )}
            {busyHere && (
              <div className="wb-chat-status" role="status">
                {status}…
              </div>
            )}
          </div>
          {bridge === "connecting" && !busy && (
            <div className="wb-chat-notice">
              <span>
                Waiting for the agent bridge. <code>npm run dev</code> starts it together with the app.
              </span>
            </div>
          )}
          <form
            className="wb-chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <textarea
              className="wb-input wb-chat-input"
              value={state.draft}
              rows={2}
              placeholder="Message the assistant"
              aria-label="Message"
              onChange={(e) => setState({ ...state, draft: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            {busy ? (
              <button className="wb-button" type="button" onClick={() => running.get(id)?.stop()}>
                Stop
              </button>
            ) : (
              <button className="wb-button" type="submit" disabled={!state.draft.trim()}>
                Send
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

/** Add this to an app's `tools` to give it an assistant panel. */
export const chatTool = defineTool<State>({
  id: "chat",
  title: "Assistant",
  glyph: "✦",
  category: "Assistant",
  // The conversations belong to the session: switching workspace must not wipe them.
  keepAcrossWorkspaces: true,
  version: 3,
  stateSchema,
  defaultState: () => ({ conversations: [], active: null, draft: "", showList: false }),
  // Versions 1 and 2 held a single conversation.
  migrate: (state) => {
    const old = (state ?? {}) as { messages?: Message[]; sessionId?: string | null; draft?: string };
    const messages = Array.isArray(old.messages) ? old.messages : [];
    const first = messages.find((m) => m.role === "user")?.text ?? "Earlier conversation";
    const conversation: Conversation = { id: "migrated", title: titleFrom(first), messages, sessionId: old.sessionId ?? null, agent: null, updated: new Date().toISOString() };
    return { conversations: messages.length ? [conversation] : [], active: messages.length ? "migrated" : null, draft: old.draft ?? "", showList: false };
  },
  component: Chat,
  // The agent already has the conversation; it only needs to know the panel exists.
  describe: (state) => ({
    note: "The chat panel the user talks to the agent through.",
    conversations: state.conversations.length,
    openConversation: state.conversations.find((c) => c.id === state.active)?.title ?? null,
  }),
});
