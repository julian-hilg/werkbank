import { sectorOf } from "../market/history";
import { defineTool, openContextMenu, useLink, useToolState, useWerkbank } from "@werkbank/framework";
import { z } from "zod";
import { feed, type Quote } from "../market/feed";
import { useFeedStatus, useFeedVersion } from "../market/hooks";
import { SYMBOLS, isSymbol, type SymbolId } from "../market/history";
import { compact, pct, price, tone } from "./format";
import { symbolMenu } from "./menus";

const stateSchema = z.object({ sort: z.enum(["symbol", "change", "volume"]) });
type State = z.infer<typeof stateSchema>;

const change = (q: Quote) => q.last / q.prevClose - 1;
const rows = (sort: State["sort"]): Quote[] => {
  const all = SYMBOLS.map((s) => feed.getQuote(s));
  if (sort === "change") all.sort((a, b) => change(b) - change(a));
  if (sort === "volume") all.sort((a, b) => b.volume - a.volume);
  return all;
};

function Watchlist() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const [symbol, setSymbol] = useLink<SymbolId>("symbol");
  useFeedVersion();
  const stale = useFeedStatus() !== "live";
  const header = (key: State["sort"], text: string) => (
    <button className="st-sort" onClick={() => setState({ sort: key })}>
      {text}
      {state.sort === key ? " ▾" : ""}
    </button>
  );
  return (
    <table className="wb-table">
      <thead>
        <tr>
          <th>{header("symbol", "Symbol")}</th>
          <th>Last</th>
          <th>{header("change", "Chg")}</th>
          <th>Bid</th>
          <th>Ask</th>
          <th>{header("volume", "Vol")}</th>
        </tr>
      </thead>
      <tbody className={stale ? "wb-stale" : undefined}>
        {rows(state.sort).map((q) => {
          const selected = q.symbol === symbol;
          return (
            <tr
              key={q.symbol}
              aria-selected={selected}
              tabIndex={0}
              onClick={() => setSymbol(q.symbol)}
              onKeyDown={(e) => e.key === "Enter" && setSymbol(q.symbol)}
              onContextMenu={(e) => openContextMenu(wb, e, symbolMenu(wb, q.symbol, setSymbol))}
            >
              <td>{q.symbol}</td>
              {/* The key restarts the flash animation on every trade. */}
              <td key={q.seq} className={q.tick > 0 ? "wb-flash-up" : q.tick < 0 ? "wb-flash-down" : undefined}>
                {price(q.last)}
              </td>
              <td className={selected ? undefined : tone(change(q))}>{pct(change(q))}</td>
              <td>{price(q.bid)}</td>
              <td>{price(q.ask)}</td>
              <td>{compact(q.volume)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export const watchlist = defineTool<State>({
  id: "watchlist",
  title: "Watchlist",
  glyph: "≣",
  category: "Trading",
  version: 1,
  stateSchema,
  defaultState: () => ({ sort: "symbol" }),
  links: ["symbol"],
  component: Watchlist,
  describe: (state, { links }) => ({
    selected: isSymbol(links.symbol) ? links.symbol : null,
    note: "Simulated live quotes.",
    feed: feed.getStatus(),
    rows: rows(state.sort).map((q) => ({
      symbol: q.symbol, sector: sectorOf(q.symbol), last: q.last, bid: q.bid, ask: q.ask, changePct: Math.round(change(q) * 10000) / 100, volume: q.volume,
    })),
  }),
});
