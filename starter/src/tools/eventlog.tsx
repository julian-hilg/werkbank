import { defineTool, useToolState } from "@werkbank/framework";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { z } from "zod";
import { eventLog, type AppEvent } from "../events";
import { clock } from "./format";
import { downloadCsv } from "./lib";

const stateSchema = z.object({ level: z.enum(["all", "warn", "error"]), query: z.string().max(80), follow: z.boolean() });
type State = z.infer<typeof stateSchema>;

const select = (events: AppEvent[], state: State) => {
  const q = state.query.trim().toLowerCase();
  return events.filter(
    (e) => (state.level === "all" || e.level === state.level || (state.level === "warn" && e.level === "error")) && (!q || `${e.source} ${e.message}`.toLowerCase().includes(q)),
  );
};
const MARK = { info: "·", warn: "▲", error: "■" } as const;

function EventLog() {
  const [state, setState] = useToolState<State>();
  const events = useSyncExternalStore(eventLog.subscribe, eventLog.getAll);
  const rows = select(events, state).slice(-400);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.follow) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [rows.length, state.follow]);
  return (
    <div className="st-log">
      <div className="wb-toolhead">
        <input className="wb-input" type="search" value={state.query} placeholder="Filter" aria-label="Filter events" style={{ maxWidth: 160 }} onChange={(e) => setState({ ...state, query: e.target.value })} />
        <span className="wb-segment" role="group" aria-label="Level">
          {(["all", "warn", "error"] as const).map((level) => (
            <button key={level} className="wb-button" aria-pressed={state.level === level} onClick={() => setState({ ...state, level })}>
              {level === "all" ? "All" : level === "warn" ? "Warnings+" : "Errors"}
            </button>
          ))}
        </span>
        <label className="st-check">
          <input type="checkbox" checked={state.follow} onChange={(e) => setState({ ...state, follow: e.target.checked })} />
          follow
        </label>
        <span>{rows.length} shown</span>
        <span className="st-grow" />
        <button className="wb-button" onClick={() => downloadCsv("events.csv", ["time", "level", "source", "message"], select(events, state).map((e) => [new Date(e.time).toISOString(), e.level, e.source, e.message]))}>
          CSV
        </button>
        <button className="wb-button" onClick={() => eventLog.clear()}>
          Clear
        </button>
      </div>
      <div className="st-log-list" ref={list} role="log" aria-label="Events">
        {rows.map((e) => (
          <div key={e.seq} className="st-log-row" data-level={e.level}>
            <span className="st-dim">{clock(e.time)}</span>
            <span aria-label={e.level}>{MARK[e.level]}</span>
            <span className="st-dim">{e.source}</span>
            <span>{e.message}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="st-blank">No events yet. Place an order, edit a task or pause the feed.</p>}
      </div>
    </div>
  );
}

export const eventLogTool = defineTool<State>({
  id: "eventlog",
  title: "Event log",
  glyph: "≡",
  category: "Showcase",
  version: 1,
  stateSchema,
  defaultState: () => ({ level: "all", query: "", follow: true }),
  component: EventLog,
  describe: (state) => {
    const rows = select(eventLog.getAll(), state);
    return {
      filter: state,
      shown: rows.length,
      latest: rows.slice(-15).map((e) => ({ time: new Date(e.time).toISOString(), level: e.level, source: e.source, message: e.message })),
    };
  },
});
