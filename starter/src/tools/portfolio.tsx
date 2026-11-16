import { copyText, defineTool, openContextMenu, useLink, useToolState, useWerkbank } from "@werkbank/framework";
import { z } from "zod";
import { useFeedStatus } from "../market/hooks";
import type { SymbolId } from "../market/history";
import { START_CASH } from "../portfolio/ledger";
import { liveValuation, useValuation } from "../portfolio/live";
import { pct, price, signed, tone, whole } from "./format";
import { downloadCsv } from "./lib";
import { symbolMenu } from "./menus";

const stateSchema = z.object({ sort: z.enum(["symbol", "value", "unrealised", "day"]), showClosed: z.boolean() });
type State = z.infer<typeof stateSchema>;
type Row = ReturnType<typeof liveValuation>["rows"][number];

const ordered = (rows: Row[], state: State) => {
  const visible = rows.filter((r) => state.showClosed || r.qty !== 0);
  if (state.sort === "symbol") return visible.sort((a, b) => a.symbol.localeCompare(b.symbol));
  const key = state.sort;
  return visible.sort((a, b) => b[key] - a[key]);
};

function Portfolio() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const [symbol, setSymbol] = useLink<SymbolId>("symbol");
  const v = useValuation();
  const stale = useFeedStatus() !== "live";
  const rows = ordered([...v.rows], state);
  const header = (key: State["sort"], text: string) => (
    <button className="st-sort" onClick={() => setState({ ...state, sort: key })}>
      {text}
      {state.sort === key ? " ▾" : ""}
    </button>
  );
  return (
    <>
      <div className="wb-toolhead">
        <span>
          Equity <strong className="wb-num">{whole(v.equity)}</strong>
        </span>
        <span>
          Cash <span className="wb-num">{whole(v.cash)}</span>
        </span>
        {stale && <span className="wb-badge" data-tone="warn">marked to stale prices</span>}
        <span className="st-grow" />
        <button
          className="wb-button"
          onClick={() =>
            downloadCsv(
              "portfolio.csv",
              ["symbol", "qty", "avg_cost", "last", "value", "weight", "day_pnl", "unrealised", "realised"],
              rows.map((r) => [r.symbol, r.qty, r.avgCost.toFixed(4), r.last, r.value.toFixed(2), r.weight.toFixed(4), r.day.toFixed(2), r.unrealised.toFixed(2), r.realised.toFixed(2)]),
            )
          }
        >
          CSV
        </button>
        <label className="st-check">
          <input type="checkbox" checked={state.showClosed} onChange={(e) => setState({ ...state, showClosed: e.target.checked })} />
          closed
        </label>
      </div>
      <table className="wb-table">
        <thead>
          <tr>
            <th>{header("symbol", "Symbol")}</th>
            <th>Qty</th>
            <th>Avg cost</th>
            <th>Last</th>
            <th>{header("value", "Value")}</th>
            <th>Weight</th>
            <th>{header("day", "Day P&L")}</th>
            <th>{header("unrealised", "Unrealised")}</th>
            <th>Realised</th>
          </tr>
        </thead>
        <tbody className={stale ? "wb-stale" : undefined}>
          {rows.map((r) => {
            const selected = r.symbol === symbol;
            const cls = (n: number) => (selected ? undefined : tone(n));
            return (
              <tr
                key={r.symbol}
                aria-selected={selected}
                tabIndex={0}
                onClick={() => setSymbol(r.symbol)}
                onKeyDown={(e) => e.key === "Enter" && setSymbol(r.symbol)}
                onContextMenu={(e) =>
                  openContextMenu(wb, e, [
                    ...symbolMenu(wb, r.symbol, setSymbol),
                    { separator: true },
                    { label: `Copy position (${whole(r.qty)} at ${price(r.avgCost)})`, run: () => copyText(`${r.symbol}\t${r.qty}\t${r.avgCost.toFixed(4)}\t${r.last}\t${r.value.toFixed(2)}\t${r.unrealised.toFixed(2)}`) },
                  ])
                }
              >
                <td>{r.symbol}</td>
                <td>{whole(r.qty)}</td>
                <td>{r.qty ? price(r.avgCost) : "–"}</td>
                <td>{price(r.last)}</td>
                <td>{whole(r.value)}</td>
                <td>{(r.weight * 100).toFixed(1)}%</td>
                <td className={cls(r.day)}>{signed(r.day)}</td>
                <td className={cls(r.unrealised)}>
                  {signed(r.unrealised)}
                  {r.qty ? ` (${pct(r.last / r.avgCost - 1)})` : ""}
                </td>
                <td className={cls(r.realised)}>{signed(r.realised)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td />
            <td />
            <td />
            <td>{whole(v.equity - v.cash)}</td>
            <td>{(((v.equity - v.cash) / v.equity) * 100).toFixed(1)}%</td>
            <td className={tone(v.day)}>{signed(v.day)}</td>
            <td className={tone(v.unrealised)}>{signed(v.unrealised)}</td>
            <td className={tone(v.realised)}>{signed(v.realised)}</td>
          </tr>
        </tfoot>
      </table>
    </>
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export const portfolio = defineTool<State>({
  id: "portfolio",
  title: "Portfolio",
  glyph: "◫",
  category: "Trading",
  version: 1,
  stateSchema,
  defaultState: () => ({ sort: "value", showClosed: false }),
  links: ["symbol"],
  component: Portfolio,
  describe: (state) => {
    const v = liveValuation();
    return {
      note: "Paper portfolio on simulated prices. Long-only, cash-only.",
      startingCash: START_CASH,
      equity: r2(v.equity),
      cash: r2(v.cash),
      pnl: { total: r2(v.total), day: r2(v.day), unrealised: r2(v.unrealised), realised: r2(v.realised) },
      positions: ordered([...v.rows], state).map((r) => ({
        symbol: r.symbol, qty: r.qty, avgCost: r2(r.avgCost), last: r.last, value: r2(r.value),
        weightPct: r2(r.weight * 100), dayPnl: r2(r.day), unrealised: r2(r.unrealised), realised: r2(r.realised),
      })),
    };
  },
});
