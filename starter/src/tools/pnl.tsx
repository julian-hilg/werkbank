import { defineTool, useToolState } from "@werkbank/framework";
import { useMemo } from "react";
import { z } from "zod";
import { useFeedStatus } from "../market/hooks";
import { TODAY } from "../market/history";
import { START_CASH, equityHistory, ledger } from "../portfolio/ledger";
import { liveValuation, useSession, useTrades, useValuation } from "../portfolio/live";
import { LineChart, type Point } from "./LineChart";
import { clock, pct, signed, whole } from "./format";

const stateSchema = z.object({ view: z.enum(["history", "session"]), by: z.enum(["total", "day"]) });
type State = z.infer<typeof stateSchema>;

const fmt = (n: number) => signed(n);

function Pnl() {
  const [state, setState] = useToolState<State>();
  const v = useValuation();
  const trades = useTrades();
  const session = useSession();
  const stale = useFeedStatus() !== "live";

  // The daily curve only changes when a trade is made; the live point is appended.
  const daily = useMemo(() => equityHistory(trades), [trades]);
  const points: Point[] =
    state.view === "history"
      ? [...daily.map((d) => ({ label: d.date, value: d.pnl })), { label: `${TODAY} (live)`, value: v.total }]
      : session.map((s) => ({ label: clock(s.time), value: s.day }));

  // Attribution: each position's share of the chosen P&L, largest first.
  const parts = v.rows
    .map((r) => ({ symbol: r.symbol, value: state.by === "day" ? r.day : r.unrealised + r.realised }))
    .filter((p) => p.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const widest = Math.max(1, ...parts.map((p) => Math.abs(p.value)));

  const tile = (label: string, value: number, sub?: string) => (
    <div className="wb-kpi">
      <div className="wb-kpi-label">{label}</div>
      <div className="wb-kpi-value">
        <span className="st-mark" data-sign={Math.sign(value)} aria-hidden />
        {signed(value)}
      </div>
      {sub && <div className="wb-kpi-label">{sub}</div>}
    </div>
  );

  return (
    <div className="st-pnl">
      <div className={`wb-kpis ${stale ? "wb-stale" : ""}`}>
        {tile("Day P&L", v.day, pct(v.day / (v.equity - v.day)))}
        {tile("Total P&L", v.total, pct(v.total / START_CASH))}
        {tile("Unrealised", v.unrealised)}
        {tile("Realised", v.realised)}
        <div className="wb-kpi">
          <div className="wb-kpi-label">Equity</div>
          <div className="wb-kpi-value">{whole(v.equity)}</div>
          <div className="wb-kpi-label">cash {whole(v.cash)}</div>
        </div>
      </div>
      <div className="wb-toolhead">
        <strong>{state.view === "history" ? "Total P&L by day" : "Day P&L this session"}</strong>
        {stale && <span className="wb-badge" data-tone="warn">feed not live</span>}
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="Period">
          {(["history", "session"] as const).map((view) => (
            <button key={view} className="wb-button" aria-pressed={state.view === view} onClick={() => setState({ ...state, view })}>
              {view === "history" ? "1Y daily" : "Session"}
            </button>
          ))}
        </span>
      </div>
      <div className="st-pnl-chart">
        <LineChart points={points} format={fmt} label={state.view === "history" ? "Total profit and loss by day" : "Day profit and loss during this session"} />
      </div>
      <div className="wb-toolhead">
        <strong>By position</strong>
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="Measure">
          {(["total", "day"] as const).map((by) => (
            <button key={by} className="wb-button" aria-pressed={state.by === by} onClick={() => setState({ ...state, by })}>
              {by === "total" ? "Total" : "Day"}
            </button>
          ))}
        </span>
      </div>
      <ul className="st-bars" aria-label={`P&L by position, ${state.by}`}>
        {parts.map((p) => (
          <li key={p.symbol} title={`${p.symbol}: ${signed(p.value)}`}>
            <span>{p.symbol}</span>
            <span className="st-bar-track">
              <span className="st-bar" data-sign={Math.sign(p.value)} style={{ width: `${(Math.abs(p.value) / widest) * 50}%` }} />
            </span>
            <span className="wb-num">{signed(p.value)}</span>
          </li>
        ))}
        {parts.length === 0 && <li className="wb-hint">No positions.</li>}
      </ul>
    </div>
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export const pnl = defineTool<State>({
  id: "pnl",
  title: "P&L",
  glyph: "±",
  category: "Trading",
  version: 1,
  stateSchema,
  defaultState: () => ({ view: "history", by: "total" }),
  component: Pnl,
  describe: () => {
    const v = liveValuation();
    const daily = equityHistory(ledger.getTrades());
    const worst = daily.reduce((min, d) => (d.pnl < min.pnl ? d : min), daily[0]!);
    const best = daily.reduce((max, d) => (d.pnl > max.pnl ? d : max), daily[0]!);
    return {
      note: "Paper P&L on simulated prices. Total is since the account started with its opening cash.",
      total: r2(v.total), day: r2(v.day), unrealised: r2(v.unrealised), realised: r2(v.realised), equity: r2(v.equity),
      dailyCurve: { days: daily.length, lowest: worst, highest: best, lastClose: daily.at(-1) },
      byPosition: v.rows.map((r) => ({ symbol: r.symbol, total: r2(r.unrealised + r.realised), day: r2(r.day) })),
    };
  },
});
