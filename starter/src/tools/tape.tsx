import { defineTool, useLink, useToolState } from "@werkbank/framework";
import { z } from "zod";
import { feed } from "../market/feed";
import { useFeedStatus, useQuote, useTape } from "../market/hooks";
import { isSymbol, type SymbolId } from "../market/history";
import { clock, price, whole } from "./format";

const stateSchema = z.object({ minSize: z.number().int().min(0) });
type State = z.infer<typeof stateSchema>;
const SIZES = [0, 500, 1000];

function Tape() {
  const [state, setState] = useToolState<State>();
  const [symbol] = useLink<SymbolId>("symbol");
  const tape = useTape(symbol);
  const quote = useQuote(symbol);
  const status = useFeedStatus();
  if (!symbol || !quote) return <p className="st-blank">No symbol. Link this panel to a group, or pick a symbol in a watchlist.</p>;
  const rows = tape.filter((p) => p.size >= state.minSize).slice(0, 80);
  return (
    <>
      <div className="wb-toolhead">
        <strong>{symbol}</strong>
        <span className="wb-num">
          {whole(quote.bidSize)} × {price(quote.bid)} / {price(quote.ask)} × {whole(quote.askSize)}
        </span>
        {status !== "live" && <span className="wb-badge" data-tone="warn">feed {status}</span>}
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="Minimum size">
          {SIZES.map((size) => (
            <button key={size} className="wb-button" aria-pressed={state.minSize === size} onClick={() => setState({ minSize: size })}>
              {size ? `≥${size}` : "All"}
            </button>
          ))}
        </span>
      </div>
      <table className="wb-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Price</th>
            <th>Size</th>
            <th>Side</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.seq}>
              <td>{clock(p.time)}</td>
              <td className={p.side === "buy" ? "wb-up" : "wb-down"}>{price(p.price)}</td>
              <td>{whole(p.size)}</td>
              <td>{p.side === "buy" ? "▲ at ask" : "▼ at bid"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="st-blank">Waiting for trades…</p>}
    </>
  );
}

export const tape = defineTool<State>({
  id: "tape",
  title: "Time & sales",
  glyph: "⋮",
  category: "Trading",
  version: 1,
  stateSchema,
  defaultState: () => ({ minSize: 0 }),
  links: ["symbol"],
  component: Tape,
  describe: (state, { links }) => {
    const symbol = isSymbol(links.symbol) ? links.symbol : null;
    if (!symbol) return { symbol: null };
    const prints = feed.getTape(symbol).filter((p) => p.size >= state.minSize);
    return {
      symbol,
      feed: feed.getStatus(),
      note: "Simulated trade prints, newest first.",
      printsHeld: prints.length,
      latest: prints.slice(0, 10).map(({ time, price, size, side }) => ({ time: new Date(time).toISOString(), price, size, side })),
    };
  },
});
