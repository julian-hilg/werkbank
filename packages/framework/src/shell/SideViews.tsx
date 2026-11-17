import { useRef, useState, type PointerEvent } from "react";
import { useDoc, useMeta, useWerkbank } from "../tools";

export const SIDE_VIEWS = [
  { id: "tools", title: "Tools", glyph: "▦" },
  { id: "workspaces", title: "Workspaces", glyph: "❏" },
  { id: "history", title: "Action history", glyph: "↺" },
] as const;

type ToolDrag = (event: PointerEvent, toolId: string, title: string) => void;

/** The collapsible dock at the left edge. It takes no space when closed. */
export function SideDock({ onToolDrag }: { onToolDrag: ToolDrag }) {
  const wb = useWerkbank();
  const view = useDoc((doc) => doc.shell.sideView);
  const stored = useDoc((doc) => doc.shell.sideWidth);
  const [dragging, setDragging] = useState<number | null>(null);
  const width = dragging ?? stored;
  const title = SIDE_VIEWS.find((v) => v.id === view)?.title ?? "";

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const clamp = (x: number) => Math.round(Math.min(480, Math.max(140, stored + x - startX)));
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => setDragging(clamp(e.clientX));
    const up = (e: globalThis.PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      setDragging(null);
      wb.setShell({ sideWidth: clamp(e.clientX) });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  return (
    <aside className="wb-side" style={{ width }} aria-label={title}>
      <div className="wb-side-content">
        <h2 className="wb-side-title">{title}</h2>
        {view === "tools" && <ToolsView onToolDrag={onToolDrag} />}
        {view === "workspaces" && <WorkspacesView />}
        {view === "history" && <HistoryView />}
      </div>
      <div className="wb-side-resize" onPointerDown={resize} role="separator" aria-orientation="vertical" />
    </aside>
  );
}

function ToolsView({ onToolDrag }: { onToolDrag: ToolDrag }) {
  const wb = useWerkbank();
  useMeta((meta) => meta.toolsVersion);
  // Which tools have a panel open: a click goes to it, a drag opens another.
  const open = new Set(useDoc((doc) => [...new Set(Object.values(doc.instances).map((inst) => inst.toolId))].sort().join("\n")).split("\n"));
  const show = (toolId: string) => {
    const id = wb.openPanelOf(toolId);
    void (id ? wb.run("panel.focus", { id }) : wb.run("panel.open", { toolId }));
  };
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = new Map<string, typeof tools>();
  const tools = [...wb.tools.values()].filter((t) => !q || `${t.title} ${t.category ?? ""}`.toLowerCase().includes(q));
  for (const tool of tools) groups.set(tool.category ?? "", [...(groups.get(tool.category ?? "") ?? []), tool]);
  return (
    <>
      {wb.tools.size > 12 && (
        <div className="wb-row">
          <input className="wb-input" type="search" value={query} placeholder="Filter tools" aria-label="Filter tools" onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {[...groups].map(([category, items]) => (
        <section key={category}>
          {category && <h3 className="wb-side-heading">{category}</h3>}
          <ul className="wb-list">
            {items.map((tool) => (
              <li key={tool.id}>
                <button
                  className="wb-list-item"
                  style={{ touchAction: "none" }}
                  data-open={open.has(tool.id) || undefined}
                  title={open.has(tool.id) ? "Open. Click to go to it; drag into the layout to open another." : undefined}
                  onPointerDown={(e) => onToolDrag(e, tool.id, tool.title)}
                  onClick={() => show(tool.id)}
                >
                  <span className="wb-glyph">{tool.glyph ?? tool.title.slice(0, 1)}</span>
                  {tool.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {tools.length === 0 && <p className="wb-hint">No tool matches.</p>}
      <p className="wb-hint">Click to open a tool, or to go to it when it is already open. Drag it into the layout to open another one.</p>
    </>
  );
}

function WorkspacesView() {
  const wb = useWerkbank();
  const current = useDoc((doc) => doc.name);
  // Re-read the saved names whenever the log or document changes.
  useMeta((meta) => meta.saved);
  const [name, setName] = useState("");
  const [, refresh] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const names = wb.storage.names();

  const report = async (work: Promise<{ ok: boolean; error?: string; value?: unknown }>) => {
    const result = await work;
    const notes = result.ok && Array.isArray(result.value) ? (result.value as string[]) : [];
    setMessage(result.ok ? (notes.length ? notes.join(" ") : null) : (result.error ?? "Failed."));
    refresh((n) => n + 1);
  };

  const exportDoc = async () => {
    const result = await wb.run("workspace.export");
    if (!result.ok) return;
    const blob = new Blob([JSON.stringify(result.value, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${wb.config.appId}-${current}.workspace.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const importDoc = async (picked: File | undefined) => {
    if (!picked) return;
    let doc: unknown;
    try {
      doc = JSON.parse(await picked.text());
    } catch {
      return setMessage("That file is not JSON.");
    }
    await report(wb.run("workspace.import", { doc }));
  };

  return (
    <>
      <form
        className="wb-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void report(wb.run("workspace.save", { name })).then(() => setName(""));
        }}
      >
        <input className="wb-input" value={name} placeholder="Name" aria-label="Workspace name" onChange={(e) => setName(e.target.value)} />
        <button className="wb-button" type="submit" disabled={!name.trim()}>
          Save
        </button>
      </form>
      <ul className="wb-list">
        {names.map((n) => (
          <li key={n} className="wb-row">
            <button className="wb-list-item" onClick={() => void report(wb.run("workspace.load", { name: n }))}>
              {n}
            </button>
            <button className="wb-tool-button" title={`Delete ${n}`} aria-label={`Delete ${n}`} onClick={() => void report(wb.run("workspace.delete", { name: n }))}>
              ×
            </button>
          </li>
        ))}
        {names.length === 0 && <li className="wb-hint">No saved workspaces yet.</li>}
      </ul>
      {Object.keys(wb.config.presets ?? {}).length > 0 && (
        <>
          <h3 className="wb-side-title">Presets</h3>
          <ul className="wb-list">
            {Object.keys(wb.config.presets!).map((n) => (
              <li key={n}>
                <button className="wb-list-item" onClick={() => void report(wb.run("workspace.preset", { name: n }))}>
                  {n}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="wb-row wb-wrap">
        <button className="wb-button" onClick={() => void report(wb.run("workspace.reset"))}>
          Reset to default
        </button>
        <button className="wb-button" onClick={() => void exportDoc()}>
          Export
        </button>
        <button className="wb-button" onClick={() => file.current?.click()}>
          Import
        </button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => (void importDoc(e.target.files?.[0]), (e.target.value = ""))} />
      </div>
      {message && <p className="wb-hint wb-warn">{message}</p>}
    </>
  );
}

function HistoryView() {
  const wb = useWerkbank();
  const log = useMeta((meta) => meta.log);
  const canUndo = log.some((e) => e.before && !e.undone);
  return (
    <>
      <div className="wb-row">
        <button className="wb-button" disabled={!canUndo} onClick={() => void wb.run("history.undo")}>
          Undo last action
        </button>
      </div>
      <ul className="wb-list wb-log">
        {[...log].reverse().map((entry) => (
          <li key={entry.seq} className="wb-log-entry" data-undone={entry.undone || undefined} data-failed={!entry.ok || undefined}>
            <span className="wb-actor" data-actor={entry.actor}>
              {entry.actor}
            </span>
            <span className="wb-log-title">
              {entry.title}
              {entry.undone ? " (undone)" : ""}
              {entry.error ? `: ${entry.error}` : ""}
            </span>
            <code className="wb-log-input">{entry.input === undefined ? "" : JSON.stringify(entry.input)}</code>
          </li>
        ))}
        {log.length === 0 && <li className="wb-hint">Nothing yet. Actions by you and by agents appear here.</li>}
      </ul>
    </>
  );
}
