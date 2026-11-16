import { copyText, defineTool, openContextMenu, useToolState, useWerkbank } from "@werkbank/framework";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { COLUMNS, ROW_COUNT, selectOrders, type OrderRow } from "../data/orders";
import { downloadCsv } from "./lib";
import { price, whole } from "./format";

const stateSchema = z.object({
  query: z.string().max(80),
  side: z.enum(["all", "buy", "sell"]),
  sort: z.enum(["id", "time", "symbol", "side", "qty", "price", "venue", "trader", "status"]),
  descending: z.boolean(),
});
type State = z.infer<typeof stateSchema>;

const ROW = 20;
const OVERSCAN = 8;
const show = (row: OrderRow, key: keyof OrderRow) => (key === "price" ? price(row.price) : key === "qty" ? whole(row.qty) : String(row[key]));
const TOTAL_WIDTH = COLUMNS.reduce((s, c) => s + c.width, 0);

function Grid() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const rows = useMemo(() => selectOrders(state), [state]);
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const height = viewport.current?.clientHeight ?? 400;
  // Only the rows in view (plus a few either side) exist in the page.
  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN);
  const volume = useMemo(() => rows.reduce((s, r) => s + r.qty, 0), [rows]);

  const sortBy = (key: State["sort"]) => {
    setState({ ...state, sort: key, descending: state.sort === key ? !state.descending : false });
    viewport.current?.scrollTo({ top: 0 });
  };
  return (
    <div className="st-grid">
      <div className="wb-toolhead">
        <input
          className="wb-input"
          type="search"
          value={state.query}
          placeholder="Filter: symbol, venue, trader, status or id"
          aria-label="Filter rows"
          style={{ maxWidth: 260 }}
          onChange={(e) => (setState({ ...state, query: e.target.value }), viewport.current?.scrollTo({ top: 0 }))}
        />
        <span className="wb-segment" role="group" aria-label="Side">
          {(["all", "buy", "sell"] as const).map((side) => (
            <button key={side} className="wb-button" aria-pressed={state.side === side} onClick={() => setState({ ...state, side })}>
              {side === "all" ? "All" : side === "buy" ? "Buys" : "Sells"}
            </button>
          ))}
        </span>
        <span className="wb-num">
          {whole(rows.length)} of {whole(ROW_COUNT)} rows · {whole(volume)} shares
        </span>
        <span className="wb-badge">sample data</span>
        <span className="st-grow" />
        <button className="wb-button" title="Download every row that matches the filter" onClick={() => downloadCsv("orders.csv", COLUMNS.map((c) => c.key), rows.map((r) => COLUMNS.map((c) => r[c.key])))}>
          CSV ({whole(rows.length)})
        </button>
      </div>
      <div className="st-grid-viewport" ref={viewport} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} role="table" aria-rowcount={rows.length + 1} aria-label="Orders">
        <div className="st-grid-head" role="row" style={{ width: TOTAL_WIDTH }}>
          {COLUMNS.map((c) => (
            <button key={c.key} role="columnheader" className="st-grid-cell" data-numeric={c.numeric || undefined} style={{ width: c.width }} onClick={() => sortBy(c.key)}>
              {c.label}
              {state.sort === c.key ? (state.descending ? " ▾" : " ▴") : ""}
            </button>
          ))}
        </div>
        <div style={{ height: rows.length * ROW, width: TOTAL_WIDTH, position: "relative" }}>
          {rows.slice(first, last).map((row, i) => (
            <div
              key={row.id}
              role="row"
              aria-rowindex={first + i + 2}
              className="st-grid-row"
              style={{ top: (first + i) * ROW, height: ROW }}
              onContextMenu={(e) =>
                openContextMenu(wb, e, [
                  { label: `Show only ${row.symbol}`, run: () => setState({ ...state, query: row.symbol.toLowerCase() }) },
                  { label: `Show only ${row.trader}'s orders`, run: () => setState({ ...state, query: row.trader }) },
                  { label: `Show only ${row.venue}`, run: () => setState({ ...state, query: row.venue.toLowerCase() }) },
                  { label: "Clear the filter", disabled: !state.query && state.side === "all", run: () => setState({ ...state, query: "", side: "all" }) },
                  { separator: true },
                  { label: "Copy row as JSON", run: () => copyText(JSON.stringify(row)) },
                  { label: "Copy row as tab-separated", run: () => copyText(COLUMNS.map((c) => row[c.key]).join("\t")) },
                ])
              }
            >
              {COLUMNS.map((c) => (
                <span key={c.key} role="cell" className="st-grid-cell" data-numeric={c.numeric || undefined} style={{ width: c.width }}>
                  {show(row, c.key)}
                </span>
              ))}
            </div>
          ))}
        </div>
        {rows.length === 0 && <p className="st-blank">No rows match.</p>}
      </div>
    </div>
  );
}

export const gridTool = defineTool<State>({
  id: "grid",
  title: "Large grid",
  glyph: "▦",
  category: "Showcase",
  version: 1,
  stateSchema,
  defaultState: () => ({ query: "", side: "all", sort: "id", descending: false }),
  component: Grid,
  describe: (state) => {
    const rows = selectOrders(state);
    const bySymbol: Record<string, { rows: number; shares: number }> = {};
    for (const r of rows) {
      const entry = (bySymbol[r.symbol] ??= { rows: 0, shares: 0 });
      entry.rows++;
      entry.shares += r.qty;
    }
    return {
      note: "Invented order records. Only the rows in view are rendered; the summary below covers every matching row.",
      filter: state,
      matchingRows: rows.length,
      totalRows: ROW_COUNT,
      bySymbol,
      firstRows: rows.slice(0, 5),
    };
  },
});
