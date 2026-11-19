import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { getAgentLink, requestAgentConnection, type ChatEvent } from "../bridge-client";
import type { Command, Conversation, ConversationMessage, Werkbank } from "../core";
import { copyText, openContextMenu } from "../menu";
import { defineTool, useDoc, useInstanceId, useMeta, useSetting, useToolState, useWerkbank } from "./index";
import { Markdown } from "./Markdown";

/**
 * The assistant panel. It does not talk to a model itself: each message goes
 * to the local agent bridge, which starts the coding agent chosen in the
 * assistant setup (Claude Code, Codex, ...). That agent sees and operates the
 * app through the same commands as everyone else, so what it does shows up in
 * the action history and anything irreversible still needs approval.
 *
 * The conversations are not the panel's: they live in the app's conversation
 * store (`wb.conversations`), so they survive the panel being closed, a
 * workspace being replaced and a reload, and every Assistant panel shows the
 * same list. The panel's own state is only which one is open, and the draft.
 */
const stateSchema = z.object({
  active: z.string().nullable(),
  draft: z.string().max(20_000),
  showList: z.boolean(),
  /** Panels whose data goes along with the next message, by id. */
  attach: z.array(z.string()).max(8).optional(),
  /** Conversations a panel held itself before the store existed. The app moves them into the store when such a workspace is loaded. */
  conversations: z.array(z.unknown()).optional(),
});
type State = z.infer<typeof stateSchema>;
type Message = ConversationMessage;

/** Turns in flight, by conversation id. They outlive a hidden or closed panel, so they live outside React. */
const running = new Map<string, { stop: () => void; status: string }>();
/** Per conversation: the message index from which text is revealed as it arrives rather than shown at once. */
const liveFrom = new Map<string, number>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
/** The conversation being answered in this page, if any. One turn at a time: two agents acting on one app would be hard to follow. */
const runningId = () => running.keys().next().value as string | undefined;

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

/** What an empty conversation offers when the app names nothing of its own. */
const SUGGESTIONS = ["Give me a short tour of what is open.", "Summarise what the panels show right now.", "Tidy the layout: put panels that belong together side by side."];
const ATTACH_LIMIT = 12_000;

/** The data of the attached panels, as the app reports it to any agent, in a form that fits in a message. */
function attachment(wb: Werkbank, ids: string[]): { titles: string[]; text: string } {
  const open = ids.filter((id) => wb.getDoc().instances[id]);
  if (!open.length) return { titles: [], text: "" };
  const data = JSON.stringify((wb.describe({ detail: "full", panels: open }) as { panels?: unknown }).panels ?? []);
  const shown = data.length > ATTACH_LIMIT ? `${data.slice(0, ATTACH_LIMIT)}… (cut; call werkbank_describe for the rest)` : data;
  return {
    titles: open.map((id) => wb.titleOf(id)),
    text: `\n\n[The person attached ${open.length === 1 ? "this panel" : "these panels"} to the message: ${open.map((id) => `${wb.titleOf(id)} (${id})`).join(", ")}. Their data as the app reports it now:\n${shown}]`,
  };
}

const download = (name: string, text: string, type: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
};
const asMarkdown = (c: Conversation) =>
  `# ${c.title}\n\n${c.messages.map((m) => (m.role === "user" ? `**You:** ${m.text}` : m.role === "assistant" ? m.text : m.role === "tool" ? `> ${m.ok === false ? "failed" : "ran"}: \`${m.text}\`` : `> Error: ${m.text}`)).join("\n\n")}\n`;
const fileName = (title: string) => title.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).toLowerCase() || "conversation";

async function send(wb: Werkbank, panelId: string, text: string, attach: string[] = []): Promise<void> {
  const store = wb.conversations;
  const agent = wb.settings.get<string>("assistant.agent") || wb.getMeta().assistant?.defaultAgent || null;
  // The message goes to the conversation open in the panel, or starts a new one.
  const panel = wb.getDoc().instances[panelId]?.state as State | undefined;
  const id = (store.get(panel?.active) ?? store.create({ title: titleFrom(text), agent })).id;
  if (panel && panel.active !== id) wb.setState(panelId, { ...panel, active: id });

  const update = (change: (c: Conversation) => Conversation, now = false) => store.update(id, change, now);
  const push = (message: Message, now = false) => update((c) => ({ ...c, messages: [...c.messages, message] }), now);
  /** Close off the message being written, optionally replacing it with its final text. */
  const settle = (finalText?: string) =>
    update((c) => {
      const last = c.messages.at(-1);
      if (last?.role !== "assistant" || !last.streaming) {
        return finalText === undefined ? c : { ...c, messages: [...c.messages, { role: "assistant" as const, text: finalText }] };
      }
      return { ...c, messages: [...c.messages.slice(0, -1), { role: "assistant" as const, text: finalText ?? last.text }] };
    }, true);
  const turn = { stop: () => {}, status: "connecting" };
  const setStatus = (status: string) => {
    turn.status = status;
    changed();
  };
  const finish = () => {
    running.delete(id);
    store.flush();
    changed();
  };

  const before = store.get(id)!;
  // A session belongs to the agent that started it; a different agent begins afresh.
  const resume = before.agent === agent ? before.sessionId : null;
  const attached = attachment(wb, attach);
  update((c) => ({ ...c, agent, sessionId: resume, title: c.messages.length === 0 ? titleFrom(text) : c.title, messages: [...c.messages, { role: "user" as const, text, ...(attached.titles.length ? { attached: attached.titles } : {}) }] }), true);
  // Where the action history stood, so what the agent does while answering can be undone together.
  const seqBefore = Math.max(0, ...wb.getMeta().log.map((e) => e.seq));
  liveFrom.set(id, store.get(id)?.messages.length ?? 0);
  running.set(id, turn);
  changed();

  if (!(await connected(wb))) {
    finish();
    return void push({ role: "error", text: "Could not reach the agent bridge. Start it with `npm run dev` (app and bridge together) or `npm run bridge`, then send again." }, true);
  }
  setStatus("starting the agent");

  const onEvent = (event: ChatEvent) => {
    if (event.type === "session") update((c) => ({ ...c, sessionId: event.sessionId }), true);
    else if (event.type === "status") setStatus(event.text);
    else if (event.type === "delta") {
      setStatus("writing");
      update((c) => {
        const last = c.messages.at(-1);
        return last?.role === "assistant" && last.streaming
          ? { ...c, messages: [...c.messages.slice(0, -1), { ...last, text: last.text + event.text }] }
          : { ...c, messages: [...c.messages, { role: "assistant" as const, text: event.text, streaming: true }] };
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
      const made = wb.getMeta().log.filter((e) => e.seq > seqBefore && e.actor === "agent" && e.before && !e.undone).map((e) => e.seq);
      if (made.length) {
        update((c) => {
          const index = c.messages.findLastIndex((m) => m.role === "assistant");
          const reply = index >= 0 && c.messages.slice(index).every((m) => m.role !== "user") ? index : -1;
          if (reply < 0) return { ...c, messages: [...c.messages, { role: "assistant" as const, text: "Done.", actions: made.slice(-200) }] };
          const messages = [...c.messages];
          messages[reply] = { ...messages[reply]!, actions: made.slice(-200) };
          return { ...c, messages };
        }, true);
      }
      if (event.error) push({ role: "error", text: event.error }, true);
      finish();
    }
  };
  turn.stop = getAgentLink(wb)!.chat(text + attached.text, resume ?? null, onEvent, { agent }).stop;
}

/** True when a conversation ends where a reply should be, and nothing is answering it. */
const unanswered = (conversation: Conversation | undefined): boolean => {
  const last = conversation?.messages.at(-1);
  return Boolean(last && (last.role === "user" || last.streaming || (last.role === "tool" && last.ok === undefined)));
};

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
  const store = wb.conversations;
  const conversations = useSyncExternalStore(store.subscribe, store.list);
  const answering = useSyncExternalStore(subscribe, runningId);
  const status = useSyncExternalStore(subscribe, () => (answering ? (running.get(answering)?.status ?? "") : ""));
  const list = useRef<HTMLDivElement>(null);
  const scrollDown = useCallback(() => list.current?.scrollTo({ top: list.current.scrollHeight }), []);

  const conversation = conversations.find((c) => c.id === state.active);
  const messages = conversation?.messages ?? [];
  const busy = Boolean(answering);
  const busyHere = Boolean(conversation && answering === conversation.id);
  const health = store.health();

  // Another tab of the app may write to the same store; closing the page must not lose the last words.
  useEffect(() => {
    store.refresh();
    const onStorage = (e: StorageEvent) => e.key === store.key && store.refresh();
    const flush = () => store.flush();
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", flush);
    };
  }, [store]);
  // A reply that never arrived (the page was reloaded mid-answer, or the bridge went away) is said so, once it is clear nothing is coming.
  const [, tick] = useState(0);
  const stalled = !busyHere && unanswered(conversation) && Date.now() - new Date(conversation!.updated).getTime() > 8000;
  useEffect(() => {
    if (busyHere || !unanswered(conversation) || stalled) return;
    const timer = setTimeout(() => tick((n) => n + 1), 8200);
    return () => clearTimeout(timer);
  }, [busyHere, conversation, stalled]);
  const live = conversation ? (liveFrom.get(conversation.id) ?? Infinity) : Infinity;
  const lastText = messages.at(-1)?.text.length ?? 0;
  const agentId = agentSetting || info?.defaultAgent || "";
  const agent = info?.agents.find((a) => a.id === agentId);
  const [filter, setFilter] = useState("");
  const wanted = filter.trim().toLowerCase();
  const listed = wanted ? conversations.filter((c) => c.title.toLowerCase().includes(wanted) || c.messages.some((m) => m.role !== "tool" && m.text.toLowerCase().includes(wanted))) : conversations;

  useEffect(() => {
    scrollDown();
  }, [messages.length, lastText, busyHere, state.active, scrollDown]);

  const instances = useDoc((doc) => doc.instances);
  const attach = (state.attach ?? []).filter((panel) => instances[panel]);
  const submit = (given?: string) => {
    const text = (given ?? state.draft).trim();
    if (!text || busy) return;
    const { attach: _sent, ...rest } = state;
    setState({ ...rest, draft: given === undefined ? "" : state.draft });
    void send(wb, id, text, attach);
  };
  const toggleAttach = (panel: string) => setState({ ...state, attach: attach.includes(panel) ? attach.filter((p) => p !== panel) : [...attach, panel].slice(-8) });
  const attachMenu = (e: React.MouseEvent) =>
    openContextMenu(wb, e, [
      { heading: "Send a panel's data with the message" },
      ...Object.values(instances)
        .filter((inst) => inst.toolId !== "chat")
        .map((inst) => ({ label: `${wb.titleOf(inst.id)}`, hint: inst.id, checked: attach.includes(inst.id), run: () => toggleAttach(inst.id) })),
    ]);
  // What the agent did while answering can be undone as one, as long as nothing was done after it.
  const log = useMeta((meta) => meta.log);
  const undoable = (actions: number[] | undefined) => {
    const mine = log.filter((e) => actions?.includes(e.seq) && e.before && !e.undone);
    if (!mine.length) return null;
    const first = Math.min(...mine.map((e) => e.seq));
    const later = log.some((e) => e.seq > first && e.before && !e.undone && !actions!.includes(e.seq));
    return { count: mine.length, later };
  };
  const undoTurn = async (count: number) => {
    for (let i = 0; i < count; i++) if (!(await wb.run("history.undo")).ok) break;
  };
  const importFile = useRef<HTMLInputElement>(null);
  const importFrom = async (file: File | undefined) => {
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return void setNotice("That file is not JSON. Conversations are imported from a file made with \"Export all\".");
    }
    const list = Array.isArray(parsed) ? parsed : (parsed as { conversations?: unknown })?.conversations;
    const result = await wb.run("conversation.import", { conversations: list });
    setNotice(result.ok ? `${result.value} conversation${result.value === 1 ? "" : "s"} imported.${result.value === 0 ? " Those in the file are already here, or it holds none." : ""}` : (result.error ?? "Import failed."));
  };
  const [notice, setNotice] = useState<string | null>(null);
  const suggestions = wb.config.assistant?.suggestions ?? SUGGESTIONS;
  const listMenu = (e: React.MouseEvent) =>
    openContextMenu(wb, e, [
      { label: "Export all to a file", disabled: !conversations.length, run: () => download(`${fileName(wb.config.title)}-conversations.json`, JSON.stringify({ app: wb.config.appId, exported: new Date().toISOString(), conversations }, null, 2), "application/json") },
      { label: "Import from a file…", run: () => importFile.current?.click() },
      { separator: true },
      { label: "Delete all conversations", danger: true, disabled: !conversations.length || busy, run: () => void wb.run("conversation.deleteAll") },
    ]);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const rename = () => {
    const title = renaming?.title.trim();
    if (renaming && title && title !== store.get(renaming.id)?.title) void wb.run("conversation.rename", { id: renaming.id, title });
    setRenaming(null);
  };
  const remove = (conversationId: string) => void wb.run("conversation.delete", { id: conversationId });
  const asText = (c: Conversation) => c.messages.filter((m) => m.role !== "tool").map((m) => `${m.role}: ${m.text}`).join("\n\n");
  const messageMenu = (message: Message) => (e: React.MouseEvent) =>
    openContextMenu(wb, e, [
      { label: "Copy message", run: () => copyText(message.text) },
      message.role === "user" && { label: "Edit and send again", run: () => setState({ ...state, draft: message.text }) },
    ]);

  return (
    <div className="wb-chat">
      <div className="wb-toolhead">
        <button className="wb-button" aria-pressed={state.showList} title="Show or hide your conversations" onClick={() => setState({ ...state, showList: !state.showList })}>
          ☰ Chats ({conversations.length})
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
        <button className="wb-button" disabled={!conversation} title="Start a fresh conversation; this one stays in the list" onClick={() => setState({ ...state, active: null })}>
          New chat
        </button>
      </div>
      <div className="wb-chat-body">
        {state.showList && (
          <nav className="wb-chat-overview" aria-label="Conversations">
            <div className="wb-chat-overview-head">
              <button className="wb-button" title="Export, import or delete conversations" aria-label="Conversation list actions" onClick={listMenu}>
                ⋯
              </button>
              <input ref={importFile} type="file" accept="application/json,.json" hidden onChange={(e) => (void importFrom(e.target.files?.[0]), (e.target.value = ""))} />
              {notice && (
                <span className="wb-hint" role="status" onClick={() => setNotice(null)}>
                  {notice}
                </span>
              )}
            </div>
            {conversations.length > 6 && (
              <input className="wb-input wb-chat-filter" type="search" value={filter} placeholder="Search conversations" aria-label="Search conversations" onChange={(e) => setFilter(e.target.value)} />
            )}
            {listed.map((c) => (
              <div
                key={c.id}
                className="wb-chat-overview-item"
                aria-current={c.id === state.active || undefined}
                onContextMenu={(e) =>
                  openContextMenu(wb, e, [
                    { label: "Open", run: () => setState({ ...state, active: c.id }) },
                    { label: "Rename", hint: "double-click", run: () => setRenaming({ id: c.id, title: c.title }) },
                    { label: "Copy as text", run: () => copyText(asText(c)) },
                    { label: "Export as Markdown", run: () => download(`${fileName(c.title)}.md`, asMarkdown(c), "text/markdown") },
                    { separator: true },
                    { label: "Delete conversation", danger: true, disabled: answering === c.id, run: () => remove(c.id) },
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
                  title="Double-click to rename"
                  onClick={() => setState({ ...state, active: c.id })}
                  onDoubleClick={() => setRenaming({ id: c.id, title: c.title })}
                >
                  <span className="wb-chat-overview-title">{c.title}</span>
                  <span className="wb-chat-overview-meta">
                    {answering === c.id ? "answering now" : ago(c.updated)} · {c.messages.filter((m) => m.role === "user").length} sent{c.agent ? ` · ${info?.agents.find((a) => a.id === c.agent)?.label ?? c.agent}` : ""}
                  </span>
                </button>
                <button className="wb-tool-button" aria-label={`Delete conversation ${c.title}`} title="Delete (can be undone from the action history)" disabled={answering === c.id} onClick={() => remove(c.id)}>
                  ×
                </button>
              </div>
            ))}
            {listed.length === 0 && <p className="wb-hint">{conversations.length ? "No conversation matches." : "No conversations yet."}</p>}
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
            {messages.length === 0 && suggestions.length > 0 && (
              <div className="wb-chat-suggestions" role="group" aria-label="Things to ask">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} className="wb-button" disabled={busy} onClick={() => submit(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {messages.map((message, i) =>
              message.role === "tool" ? (
                <div key={i} className="wb-chat-tool" data-ok={message.ok === undefined ? "pending" : String(message.ok)} onContextMenu={messageMenu(message)}>
                  <span aria-hidden>{message.ok === undefined ? "…" : message.ok ? "✓" : "✗"}</span> {message.text}
                </div>
              ) : message.role === "assistant" ? (
                <Fragment key={`${conversation!.id}:${i}`}>
                  <Reveal text={message.text} live={i >= live} caret={Boolean(busyHere && message.streaming)} onGrow={scrollDown} onMenu={messageMenu(message)} />
                  {(() => {
                    const turn = undoable(message.actions);
                    return turn ? (
                      <div className="wb-chat-turn">
                        <button
                          className="wb-button"
                          disabled={turn.later || busy}
                          title={turn.later ? "Other actions came after these. Undo those first, from the action history." : "Takes back what the assistant changed while answering this message."}
                          onClick={() => void undoTurn(turn.count)}
                        >
                          Undo {turn.count === 1 ? "this change" : `these ${turn.count} changes`}
                        </button>
                      </div>
                    ) : null;
                  })()}
                </Fragment>
              ) : (
                <div key={i} className="wb-chat-message" data-role={message.role} onContextMenu={messageMenu(message)}>
                  {message.text}
                  {message.attached?.length ? <span className="wb-chat-attached">with {message.attached.join(", ")}</span> : null}
                </div>
              ),
            )}
            {busyHere && (
              <div className="wb-chat-status" role="status">
                {status}…
              </div>
            )}
            {stalled && (
              <div className="wb-chat-notice">
                <span>No reply arrived: the page was reloaded or the connection was lost while the assistant was answering. Send your message again to continue.</span>
              </div>
            )}
          </div>
          {(health.unsaved || health.trimmed > 0) && (
            <div className="wb-chat-notice">
              <span>
                {health.unsaved
                  ? "This browser's storage for the app is full or switched off, so conversations last only until the page is closed."
                  : `This browser's storage for the app is full: the ${health.trimmed === 1 ? "oldest conversation was" : `${health.trimmed} oldest conversations were`} removed to make room.`}
              </span>
            </div>
          )}
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
            <button className="wb-button" type="button" title="Send a panel's data along with the message" aria-label="Attach a panel" aria-pressed={attach.length > 0} onClick={attachMenu}>
              ＋
            </button>
            <div className="wb-chat-compose">
              {attach.length > 0 && (
                <div className="wb-chat-attach">
                  {attach.map((panel) => (
                    <button key={panel} type="button" className="wb-badge" title="Do not send this panel's data" onClick={() => toggleAttach(panel)}>
                      {wb.titleOf(panel)} ×
                    </button>
                  ))}
                </div>
              )}
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
            </div>
            {busyHere ? (
              <button className="wb-button" type="button" onClick={() => running.get(conversation!.id)?.stop()}>
                Stop
              </button>
            ) : (
              <button className="wb-button" type="submit" disabled={busy || !state.draft.trim()} title={busy ? `The assistant is answering in "${store.get(answering)?.title ?? "another conversation"}". Wait for it, or stop it there.` : undefined}>
                Send
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

/** What people and agents can do with conversations. Deleting and renaming can be undone from the action history. */
const conversationCommands: Command<Werkbank, any>[] = [
  {
    id: "conversation.list",
    title: "List assistant conversations",
    category: "Assistant",
    risk: "read",
    palette: false,
    input: z.object({}),
    run: ({ wb }) => wb.conversations.list().map((c) => ({ id: c.id, title: c.title, updated: c.updated, sent: c.messages.filter((m) => m.role === "user").length, agent: c.agent })),
  },
  {
    id: "conversation.rename",
    title: "Rename assistant conversation",
    category: "Assistant",
    risk: "local",
    palette: false,
    input: z.object({ id: z.string().describe("From conversation.list"), title: z.string().trim().min(1).max(80) }),
    // Returns the title it had.
    run: ({ wb }, i: { id: string; title: string }) => wb.conversations.rename(i.id, i.title),
    undo: ({ wb }, i: { id: string }, previous) => void wb.conversations.rename(i.id, previous as string),
  },
  {
    id: "conversation.delete",
    title: "Delete assistant conversation",
    category: "Assistant",
    risk: "local",
    palette: false,
    input: z.object({ id: z.string().describe("From conversation.list") }),
    run: ({ wb }, i: { id: string }) => {
      if (running.has(i.id)) throw new Error("The assistant is answering in this conversation. Stop it first.");
      return wb.conversations.remove(i.id);
    },
    undo: ({ wb }, _input, removed) => wb.conversations.restore(removed as Conversation),
  },
  {
    id: "conversation.deleteAll",
    title: "Delete all assistant conversations",
    category: "Assistant",
    risk: "local",
    input: z.object({}),
    when: (wb) => wb.conversations.list().length > 0,
    run: ({ wb }) => {
      if (running.size) throw new Error("The assistant is answering. Stop it first.");
      return wb.conversations.clear();
    },
    undo: ({ wb }, _input, removed) => (removed as Conversation[]).forEach((c) => wb.conversations.restore(c)),
  },
  {
    id: "conversation.import",
    title: "Import assistant conversations",
    category: "Assistant",
    risk: "local",
    palette: false,
    input: z.object({ conversations: z.array(z.unknown()).max(500).describe("Conversations as \"Export all\" writes them. Ones already here are skipped.") }),
    // Returns how many came in; remembers which, so the import can be undone.
    run: ({ wb }, i: { conversations: unknown[] }) => {
      const before = new Set(wb.conversations.list().map((c) => c.id));
      wb.conversations.adopt(i.conversations);
      imported.set(wb, wb.conversations.list().filter((c) => !before.has(c.id)).map((c) => c.id));
      return imported.get(wb)!.length;
    },
    undo: ({ wb }) => (imported.get(wb) ?? []).forEach((id) => wb.conversations.get(id) && wb.conversations.remove(id)),
  },
];
/** The conversations the last import brought in, per app, for its undo. */
const imported = new WeakMap<Werkbank, string[]>();

/** Add this to an app's `tools` to give it an assistant panel. */
export const chatTool = defineTool<State>({
  id: "chat",
  title: "Assistant",
  glyph: "✦",
  category: "Assistant",
  // Which conversation is open, and the draft, belong to the session: switching workspace must not lose them.
  keepAcrossWorkspaces: true,
  version: 4,
  stateSchema,
  defaultState: () => ({ active: null, draft: "", showList: false }),
  // Versions 1 and 2 held a single conversation, version 3 a list. Either way the panel carries them until the app moves them into the store, when the workspace is loaded.
  migrate: (state, fromVersion) => {
    if (fromVersion >= 3) {
      const old = (state ?? {}) as Partial<State>;
      return { active: typeof old.active === "string" ? old.active : null, draft: typeof old.draft === "string" ? old.draft : "", showList: Boolean(old.showList), ...(Array.isArray(old.conversations) ? { conversations: old.conversations } : {}) };
    }
    const old = (state ?? {}) as { messages?: Message[]; sessionId?: string | null; draft?: string };
    const messages = Array.isArray(old.messages) ? old.messages : [];
    const first = messages.find((m) => m.role === "user")?.text ?? "Earlier conversation";
    const conversation: Conversation = { id: "migrated", title: titleFrom(first), messages, sessionId: old.sessionId ?? null, agent: null, updated: new Date().toISOString() };
    return { active: messages.length ? "migrated" : null, draft: old.draft ?? "", showList: false, ...(messages.length ? { conversations: [conversation] } : {}) };
  },
  component: Chat,
  commands: conversationCommands,
  // The agent already has the conversation; it only needs to know the panel exists.
  describe: (state) => ({
    note: "The chat panel the user talks to the agent through. conversation.list gives the conversations.",
    openConversation: state.active,
  }),
});
