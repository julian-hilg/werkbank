import { defineTool, useLink, useToolState } from "@werkbank/framework";
import { z } from "zod";
import { isSymbol, type SymbolId } from "../market/history";
import { ledger, type Trade } from "../portfolio/ledger";
import { useTrades } from "../portfolio/live";
import { price, whole } from "./format";
import { downloadCsv } from "./lib";

const stateSchema = z.object({ scope: z.enum(["all", "symbol"]) });
type State = z.infer<typeof stateSchema>;

const select = (trades: Trade[], scope: State["scope"], symbol: unknown) =>
  [...trades].filter((t) => scope === "all" || t.symbol === symbol).sort((a, b) => b.time - a.time);
const stamp = (t: Trade) => (t.actor === "seed" ? t.date : `${t.date} ${new Date(t.time).toLocaleTimeString("en-GB")}`);

function Blotter() {
  const [state, setState] = useToolState<State>();
  const [symbol, setSymbol] = useLink<SymbolId>("symbol");
  const rows = select(useTrades(), state.scope, symbol);
  return (
    <>
      <div className="wb-toolhead">
        <strong>{rows.length} fills</strong>
        <span className="st-grow" />
        <button className="wb-button" onClick={() => downloadCsv("fills.csv", ["id", "date", "symbol", "side", "qty", "price", "by"], rows.map((t) => [t.id, t.date, t.symbol, t.side, t.qty, t.price, t.actor]))}>
          CSV
        </button>
        <span className="wb-segment" role="group" aria-label="Scope">
          <button className="wb-button" aria-pressed={state.scope === "all"} onClick={() => setState({ scope: "all" })}>
            All
          </button>
          <button className="wb-button" aria-pressed={state.scope === "symbol"} onClick={() => setState({ scope: "symbol" })}>
            {symbol ?? "Symbol"}
          </button>
        </span>
      </div>
      <table className="wb-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Value</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} tabIndex={0} onClick={() => setSymbol(t.symbol)} onKeyDown={(e) => e.key === "Enter" && setSymbol(t.symbol)}>
              <td>{stamp(t)}</td>
              <td>{t.symbol}</td>
              <td>{t.side === "buy" ? "Buy" : "Sell"}</td>
              <td>{whole(t.qty)}</td>
              <td>{price(t.price)}</td>
              <td>{whole(t.qty * t.price)}</td>
              <td>{t.actor === "seed" ? "opening book" : t.actor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export const blotter = defineTool<State>({
  id: "blotter",
  title: "Trade blotter",
  glyph: "☰",
  category: "Trading",
  version: 1,
  stateSchema,
  defaultState: () => ({ scope: "all" }),
  links: ["symbol"],
  component: Blotter,
  describe: (state, { links }) => {
    const rows = select(ledger.getTrades(), state.scope, links.symbol);
    return {
      scope: state.scope === "symbol" && isSymbol(links.symbol) ? links.symbol : "all",
      fills: rows.length,
      note: "Paper fills, newest first. 'seed' fills are the opening book.",
      latest: rows.slice(0, 10).map(({ id, date, symbol, side, qty, price, actor }) => ({ id, date, symbol, side, qty, price, actor })),
    };
  },
});
