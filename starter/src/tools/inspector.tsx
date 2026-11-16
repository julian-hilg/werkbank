import { Select, defineTool, useDoc, useMeta, useToolState, useWerkbank } from "@werkbank/framework";
import { useMemo, useState } from "react";
import { z } from "zod";
import { downloadText } from "./lib";

const stateSchema = z.object({ source: z.enum(["agent", "document", "commands", "history"]), query: z.string().max(60) });
type State = z.infer<typeof stateSchema>;

const SOURCES = { agent: "What an agent sees", document: "Workspace document", commands: "Commands", history: "Action history" } as const;

const summary = (value: unknown): string => (Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value as object).length}}`);
const scalar = (value: unknown) => (typeof value === "string" ? JSON.stringify(value.length > 120 ? `${value.slice(0, 120)}…` : value) : String(value));

/** True if the key or anything beneath it matches the search. */
function matches(key: string, value: unknown, q: string): boolean {
  if (!q) return true;
  if (key.toLowerCase().includes(q)) return true;
  if (value === null || typeof value !== "object") return String(value).toLowerCase().includes(q);
  return Object.entries(value).some(([k, v]) => matches(k, v, q));
}

function Node({ name, value, depth, q }: { name: string; value: unknown; depth: number; q: string }) {
  const [open, setOpen] = useState(depth < 1);
  if (value === null || typeof value !== "object") {
    return (
      <div className="st-tree-row" style={{ paddingLeft: depth * 14 + 16 }}>
        <span className="st-tree-key">{name}</span> <span className="st-tree-value" data-type={value === null ? "null" : typeof value}>{scalar(value)}</span>
      </div>
    );
  }
  const entries = Object.entries(value).filter(([k, v]) => matches(k, v, q));
  const expanded = open || Boolean(q);
  return (
    <div>
      <button className="st-tree-row st-tree-toggle" style={{ paddingLeft: depth * 14 }} aria-expanded={expanded} onClick={() => setOpen(!open)}>
        <span aria-hidden>{expanded ? "▾" : "▸"}</span> <span className="st-tree-key">{name}</span> <span className="st-dim">{summary(value)}</span>
      </button>
      {expanded && entries.slice(0, 200).map(([k, v]) => <Node key={k} name={k} value={v} depth={depth + 1} q={q} />)}
      {expanded && entries.length > 200 && (
        <div className="st-tree-row st-dim" style={{ paddingLeft: depth * 14 + 30 }}>
          {entries.length - 200} more…
        </div>
      )}
    </div>
  );
}

function Inspector() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const doc = useDoc((d) => d);
  const log = useMeta((m) => m.log);
  const [stamp, setStamp] = useState(0);
  const value = useMemo(() => {
    if (state.source === "document") return doc;
    if (state.source === "commands") return Object.fromEntries(wb.commands.describe(wb, { schemas: true }).map(({ id, ...rest }) => [id, rest]));
    if (state.source === "history") return wb.history();
    return wb.describe();
  }, [wb, state.source, doc, log, stamp]);
  const q = state.query.trim().toLowerCase();
  const text = () => JSON.stringify(value, null, 2);
  return (
    <div className="st-log">
      <div className="wb-toolhead">
        <Select value={state.source} aria-label="Source" options={Object.entries(SOURCES).map(([value, label]) => ({ value: value as State["source"], label }))} onChange={(source) => setState({ ...state, source })} />
        <input className="wb-input" type="search" value={state.query} placeholder="Search keys and values" aria-label="Search" style={{ maxWidth: 180 }} onChange={(e) => setState({ ...state, query: e.target.value })} />
        <span className="st-grow" />
        {state.source === "agent" && (
          <button className="wb-button" title="This view includes live data, so it is read on request" onClick={() => setStamp((n) => n + 1)}>
            Refresh
          </button>
        )}
        <button className="wb-button" onClick={() => void navigator.clipboard?.writeText(text())}>
          Copy
        </button>
        <button className="wb-button" onClick={() => downloadText(`${state.source}.json`, text(), "application/json")}>
          JSON
        </button>
      </div>
      <div className="st-tree" role="tree" aria-label={SOURCES[state.source]}>
        <Node name={SOURCES[state.source]} value={value} depth={0} q={q} />
      </div>
    </div>
  );
}

export const inspectorTool = defineTool<State>({
  id: "inspector",
  title: "Inspector",
  glyph: "{}",
  category: "Showcase",
  version: 1,
  stateSchema,
  defaultState: () => ({ source: "agent", query: "" }),
  component: Inspector,
  describe: (state) => ({ source: state.source, note: "Shows the app's own state as a tree: what an agent reads, the saved workspace document, the command list or the action history." }),
});
