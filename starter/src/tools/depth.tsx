import { defineTool, useLink, useToolState } from "@werkbank/framework";
import { z } from "zod";
import { orderBook } from "../market/book";
import { feed } from "../market/feed";
import { useFeedStatus, useQuote } from "../market/hooks";
import { isSymbol, type SymbolId } from "../market/history";
import { price, whole } from "./format";

const stateSchema = z.object({ levels: z.union([z.literal(5), z.literal(10)]), bars: z.enum(["size", "cumulative"]) });
type State = z.infer<typeof stateSchema>;

function Depth() {
  const [state, setState] = useToolState<State>();
  const [symbol] = useLink<SymbolId>("symbol");
  const quote = useQuote(symbol);
  const status = useFeedStatus();
  if (!symbol || !quote) return <p className="st-blank">No symbol. Link this panel to a group, or pick a symbol in a watchlist.</p>;
  const book = orderBook(quote, state.levels);
  const measure = (l: { size: number; cumulative: number }) => (state.bars === "size" ? l.size : l.cumulative);
  const widest = Math.max(...[...book.bids, ...book.asks].map(measure));
  const bidTotal = book.bids.at(-1)!.cumulative;
  const askTotal = book.asks.at(-1)!.cumulative;
  const imbalance = (bidTotal - askTotal) / (bidTotal + askTotal);
  const row = (l: (typeof book.bids)[number], side: "bid" | "ask") => (
    <tr key={`${side}${l.price}`}>
      <td className="st-depth-cell">
        <span className="st-depth-bar" data-side={side} style={{ width: `${(measure(l) / widest) * 100}%` }} />
        <span className="wb-num">{whole(l.size)}</span>
      </td>
      <td className={side === "bid" ? "wb-up" : "wb-down"}>{price(l.price)}</td>
      <td>{whole(l.cumulative)}</td>
    </tr>
  );
  return (
    <div className={status === "live" ? undefined : "wb-stale"}>
      <div className="wb-toolhead">
        <strong>{symbol}</strong>
        <span className="wb-num">spread {price(quote.ask - quote.bid)}</span>
        <span className="wb-num" title="Share of resting size on the bid side minus the ask side">
          {imbalance >= 0 ? "▲" : "▼"} imbalance {(imbalance * 100).toFixed(0)}%
        </span>
        <span className="wb-badge">synthetic depth</span>
        {status !== "live" && <span className="wb-badge" data-tone="warn">feed {status}</span>}
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="Bars show">
          {(["size", "cumulative"] as const).map((bars) => (
            <button key={bars} className="wb-button" aria-pressed={state.bars === bars} onClick={() => setState({ ...state, bars })}>
              {bars === "size" ? "Size" : "Cumulative"}
            </button>
          ))}
        </span>
        <button className="wb-button" onClick={() => setState({ ...state, levels: state.levels === 5 ? 10 : 5 })}>
          {state.levels} levels
        </button>
      </div>
      <table className="wb-table st-depth">
        <thead>
          <tr>
            <th>Size</th>
            <th>Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {[...book.asks].reverse().map((l) => row(l, "ask"))}
          <tr className="st-depth-mid">
            <td colSpan={3}>last {price(quote.last)}</td>
          </tr>
          {book.bids.map((l) => row(l, "bid"))}
        </tbody>
      </table>
    </div>
  );
}

export const depthTool = defineTool<State>({
  id: "depth",
  title: "Order book",
  glyph: "⇅",
  category: "Trading",
  version: 1,
  stateSchema,
  defaultState: () => ({ levels: 10, bars: "cumulative" }),
  links: ["symbol"],
  component: Depth,
  describe: (state, { links }) => {
    if (!isSymbol(links.symbol)) return { symbol: null };
    const book = orderBook(feed.getQuote(links.symbol), state.levels);
    return { symbol: links.symbol, feed: feed.getStatus(), note: "Synthetic depth generated from the simulated quote.", bids: book.bids, asks: book.asks };
  },
});
