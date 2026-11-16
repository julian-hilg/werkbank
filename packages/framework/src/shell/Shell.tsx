import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from "react";
import { AgentLink, onConnectRequest, setAgentLink } from "../bridge-client";
import { LINK_GROUPS, eventKeys, normaliseKeys, type Werkbank } from "../core";
import { DockArea, useTabset, type DockDrag, type TabProps } from "../layout/DockArea";
import { ToolHost, WerkbankProvider, useDoc, useMeta, useWerkbank } from "../tools";
import { openContextMenu } from "../menu";
import { ContextMenuHost } from "./ContextMenu";
import { Dialogs } from "./Dialogs";
import { Palette } from "./Palette";
import { SIDE_VIEWS, SideDock } from "./SideViews";

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** A short, readable form of a link value for the status bar. */
const brief = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && Object.values(value).every((v) => typeof v !== "object")) {
    return Object.values(value).join(" – ");
  }
  return JSON.stringify(value);
};

export interface ShellProps {
  werkbank: Werkbank;
  /** Address of the local agent bridge. The app connects unless the person switches "agent" off. */
  bridgeUrl?: string;
  /** App-specific items for the status bar, such as a data-feed indicator. */
  status?: ReactNode;
}

/** The whole application frame. Projects render this once. */
export function Shell({ werkbank: wb, bridgeUrl = "ws://127.0.0.1:8787", status }: ShellProps) {
  return (
    <WerkbankProvider value={wb}>
      <Frame bridgeUrl={bridgeUrl} status={status} />
    </WerkbankProvider>
  );
}

function Frame({ bridgeUrl, status }: { bridgeUrl: string; status: ReactNode }) {
  const wb = useWerkbank();
  const shell = useDoc((doc) => doc.shell);
  const [palette, setPalette] = useState<string | null>(null);
  const dragRef = useRef<DockDrag | null>(null);
  // Whether to connect to the agent bridge is a setting; it is on unless the person switches it off.
  const bridgeOn = useSyncExternalStore(wb.settings.subscribe, () => wb.settings.get<boolean>("assistant.connect"));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", shell.theme);
    document.documentElement.setAttribute("data-density", shell.density);
  }, [shell.theme, shell.density]);

  useEffect(() => {
    if (!bridgeOn) return;
    const link = new AgentLink(wb, bridgeUrl);
    setAgentLink(wb, link);
    return () => {
      setAgentLink(wb, null);
      link.close();
    };
  }, [wb, bridgeOn, bridgeUrl]);
  const toggleBridge = useCallback(() => void wb.run("settings.set", { key: "assistant.connect", value: !wb.settings.get<boolean>("assistant.connect") }), [wb]);
  // The chat panel can ask for the connection; the person's click there is the consent.
  useEffect(() => {
    onConnectRequest(wb, () => !bridgeOn && toggleBridge());
    return () => onConnectRequest(wb, null);
  }, [wb, bridgeOn, toggleBridge]);

  useEffect(() => {
    const flush = () => wb.flush();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [wb]);

  const bindings = useMemo(() => {
    const map = new Map<string, string>();
    for (const command of wb.commands.list()) if (command.keys) map.set(normaliseKeys(command.keys), command.id);
    return map;
  }, [wb]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const keys = eventKeys(event);
      if (keys.includes("mod+k") || keys.includes("mod+shift+p")) {
        event.preventDefault();
        setPalette((open) => (open === null ? "" : null));
        return;
      }
      if (event.key.startsWith("Arrow") && isEditable(event.target)) return;
      const id = keys.map((k) => bindings.get(k)).find(Boolean);
      if (!id) return;
      event.preventDefault();
      void wb.run(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wb, bindings]);

  const renderPanel = useCallback((id: string) => <ToolHost id={id} />, []);
  const renderTab = useCallback((id: string, props: TabProps) => <Tab id={id} tabProps={props} />, []);
  const openPalette = useCallback((query: string) => setPalette(query), []);
  const renderToolbar = useCallback((tabsetId: string) => <TabsetToolbar tabsetId={tabsetId} onAdd={openPalette} />, [openPalette]);
  const renderEmpty = useCallback(
    () => (
      <div className="wb-empty">
        <p>No panels open.</p>
        <button className="wb-button" onClick={() => openPalette("Open ")}>
          Open a panel
        </button>
      </div>
    ),
    [openPalette],
  );

  const startToolDrag = useCallback(
    (event: PointerEvent, toolId: string, title: string) => {
      void dragRef.current?.dragNew(event, title).then((target) => {
        if (target) void wb.run("panel.open", { toolId, target });
      });
    },
    [wb],
  );

  return (
    <div className="wb-root" data-zen={shell.zen || undefined}>
      <div className="wb-body">
        {!shell.zen && <Rail onPalette={() => openPalette("")} />}
        {!shell.zen && shell.sideView && <SideDock onToolDrag={startToolDrag} />}
        <main className="wb-main">
          <DockArea
            wb={wb}
            dragRef={dragRef}
            renderPanel={renderPanel}
            renderTab={renderTab}
            renderToolbar={renderToolbar}
            renderEmpty={renderEmpty}
          />
        </main>
      </div>
      {!shell.zen && <StatusBar extra={status} bridgeOn={bridgeOn} onBridge={toggleBridge} onPalette={() => openPalette("")} />}
      {palette !== null && <Palette initialQuery={palette} onClose={() => setPalette(null)} />}
      <Dialogs />
      <Approval />
      <ContextMenuHost wb={wb} />
    </div>
  );
}

function Rail({ onPalette }: { onPalette: () => void }) {
  const wb = useWerkbank();
  const active = useDoc((doc) => doc.shell.sideView);
  const logo = useSyncExternalStore(wb.settings.subscribe, () => Boolean(wb.config.logo) && wb.settings.get<boolean>("appearance.logo"));
  return (
    <nav className="wb-rail" aria-label="Side views">
      {logo && (
        <button className="wb-rail-brand" title={`${wb.config.title}: documentation`} aria-label={`${wb.config.title}: documentation`} onClick={() => void wb.run("docs.open")}>
          <img src={wb.config.logo} alt="" />
        </button>
      )}
      {SIDE_VIEWS.map((view) => (
        <button
          key={view.id}
          className="wb-rail-button"
          aria-pressed={active === view.id}
          title={view.title}
          aria-label={view.title}
          onClick={() => void wb.run("view.side", { view: active === view.id ? null : view.id })}
        >
          {view.glyph}
        </button>
      ))}
      <span className="wb-rail-spacer" />
      <button className="wb-rail-button" title="Assistant setup" aria-label="Assistant setup" onClick={() => void wb.run("assistant.setup")}>
        ✦
      </button>
      <button className="wb-rail-button" title="Settings (Ctrl/Cmd+,)" aria-label="Settings" onClick={() => void wb.run("settings.open")}>
        ⚙
      </button>
      <button className="wb-rail-button" title="Commands (Ctrl/Cmd+K)" aria-label="Commands" onClick={onPalette}>
        ⌘
      </button>
    </nav>
  );
}

function Tab({ id, tabProps }: { id: string; tabProps: TabProps }) {
  const wb = useWerkbank();
  const inst = useDoc((doc) => doc.instances[id]);
  const linkable = Boolean(inst && wb.tools.get(inst.toolId)?.links?.length);
  const group = inst?.link ?? null;
  const cycle = () => {
    const order: (string | null)[] = [null, ...LINK_GROUPS];
    void wb.run("panel.link", { id, group: order[(order.indexOf(group) + 1) % order.length] });
  };
  const menu = (e: React.MouseEvent) => {
    const others = Object.keys(wb.getDoc().instances).filter((other) => other !== id);
    const run = (command: string, input: object = { id }) => () => void wb.run(command, input);
    openContextMenu(wb, e, [
      { label: "Close", run: run("panel.close") },
      { label: "Duplicate", run: run("panel.duplicate") },
      { separator: true },
      { label: "Maximise or restore", hint: "Ctrl+Shift+M", run: () => (wb.getEngine().selectTab(id), void wb.run("panel.maximize")) },
      { label: "Move to its own window", run: run("panel.popout") },
      { label: "Float above the layout", run: run("panel.float") },
      ...(linkable
        ? [
            { separator: true as const },
            { heading: "Link group" },
            ...LINK_GROUPS.map((g) => ({ label: `Group ${g}`, checked: group === g, run: run("panel.link", { id, group: g }) })),
            { label: "Not linked", checked: group === null, run: run("panel.link", { id, group: null }) },
          ]
        : []),
      { separator: true },
      { label: "Close all other panels", danger: true, disabled: others.length === 0, run: () => void wb.run("panel.closeOthers", { id }) },
    ]);
  };
  return (
    <div {...tabProps} className={`${tabProps.className ?? ""}`} data-testid={`tab-${id}`} onContextMenu={menu}>
      {linkable && (
        <button
          className="wb-link-dot"
          data-group={group ?? "none"}
          title={group ? `Linked to group ${group}. Click to change.` : "Not linked. Click to link."}
          aria-label={group ? `Link group ${group}` : "Not linked"}
          onClick={cycle}
        />
      )}
      <span className="wb-tab-title">{inst ? wb.titleOf(id) : "…"}</span>
      <button
        className="wb-tab-close"
        data-wb-close
        title="Close"
        aria-label={`Close ${wb.titleOf(id)}`}
        onClick={() => void wb.run("panel.close", { id })}
      >
        ×
      </button>
    </div>
  );
}

function TabsetToolbar({ tabsetId, onAdd }: { tabsetId: string; onAdd: (query: string) => void }) {
  const wb = useWerkbank();
  const { selectedTabId, isMaximized, isFloating } = useTabset();
  const act = (commandId: string) => () => {
    if (selectedTabId) wb.getEngine().selectTab(selectedTabId);
    wb.getEngine().focusTabset(tabsetId);
    void wb.run(commandId, selectedTabId && commandId !== "panel.maximize" ? { id: selectedTabId } : undefined);
  };
  return (
    <div className="wb-toolbar">
      <button
        className="wb-tool-button"
        title="Open a panel here"
        aria-label="Open a panel here"
        onClick={() => {
          wb.getEngine().focusTabset(tabsetId);
          onAdd("Open ");
        }}
      >
        +
      </button>
      {selectedTabId && (
        <button className="wb-tool-button" title="Move to its own window" aria-label="Move to its own window" onClick={act("panel.popout")}>
          ↗
        </button>
      )}
      {selectedTabId && !isFloating && (
        <button
          className="wb-tool-button"
          title={isMaximized ? "Restore" : "Maximise"}
          aria-label={isMaximized ? "Restore" : "Maximise"}
          onClick={act("panel.maximize")}
        >
          {isMaximized ? "❐" : "□"}
        </button>
      )}
    </div>
  );
}

function StatusBar({ extra, bridgeOn, onBridge, onPalette }: { extra: ReactNode; bridgeOn: boolean; onBridge: () => void; onPalette: () => void }) {
  const wb = useWerkbank();
  const name = useDoc((doc) => doc.name);
  const links = useDoc((doc) => doc.links);
  const count = useDoc((doc) => Object.keys(doc.instances).length);
  const saved = useMeta((meta) => meta.saved);
  const notes = useMeta((meta) => meta.notes);
  const bridge = useMeta((meta) => meta.bridge);
  const [showNotes, setShowNotes] = useState(false);
  return (
    <footer className="wb-status">
      <span title="Current workspace">{name}</span>
      <span>{count} panels</span>
      <span>{saved ? "saved" : "saving…"}</span>
      {notes.length > 0 && (
        <button className="wb-status-button wb-status-warn" onClick={() => setShowNotes((s) => !s)}>
          {notes.length} notice{notes.length > 1 ? "s" : ""}
        </button>
      )}
      {showNotes && (
        <div className="wb-notes" role="status">
          {notes.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
          <button className="wb-button" onClick={() => (wb.setMeta({ notes: [] }), setShowNotes(false))}>
            Dismiss
          </button>
        </div>
      )}
      <span className="wb-status-spacer" />
      {LINK_GROUPS.filter((g) => links[g] && Object.keys(links[g]).length > 0).map((g) => (
        <span key={g} className="wb-status-link" title={`Link group ${g}`}>
          <i className="wb-link-dot" data-group={g} />
          {Object.entries(links[g]!)
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([topic, value]) => `${topic}: ${brief(value)}`)
            .join("  ")}
        </span>
      ))}
      {extra}
      <button
        className="wb-status-button"
        onClick={onBridge}
        title={bridgeOn ? "Disconnect the agent bridge" : "Let a local agent drive this app (needs the bridge process)"}
      >
        agent: {bridgeOn ? bridge : "off"}
      </button>
      <button className="wb-status-button" onClick={onPalette}>
        Ctrl/⌘ K
      </button>
    </footer>
  );
}

/** Shown when an agent asks to do something a person must approve. */
function Approval() {
  const wb = useWerkbank();
  const pending = useMeta((meta) => meta.pendingApproval);
  if (!pending) return null;
  return (
    <div className="wb-overlay">
      <div className="wb-dialog" role="alertdialog" aria-label="Approve agent action">
        <h2>An agent wants to: {pending.title}</h2>
        <pre>{JSON.stringify(pending.input, null, 2)}</pre>
        <p>This cannot be undone from the action history.</p>
        <div className="wb-dialog-actions">
          <button className="wb-button" autoFocus onClick={() => wb.resolveApproval(false)}>
            Deny
          </button>
          <button className="wb-button" onClick={() => wb.resolveApproval(true)}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
