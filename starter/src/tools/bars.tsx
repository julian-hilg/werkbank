import { defineTool, useLink, useToolState } from "@werkbank/framework";
import { useMemo } from "react";
import { z } from "zod";
import { feed } from "../market/feed";
import { useQuote } from "../market/hooks";
import { TODAY, inRange, isSymbol, summary, type Range, type SymbolId } from "../market/history";
import { price, tone, whole } from "./format";
import { downloadCsv } from "./lib";

const stateSchema = z.object({ limit: z.number().int().min(10).max(251) });
type State = z.infer<typeof stateSchema>;

const select = (symbol: unknown, range: unknown, limit: number) =>
  isSymbol(symbol) ? inRange(feed.bars(symbol), range as Range | null).slice(-limit).reverse() : [];

function Bars() {
  const [state, setState] = useToolState<State>();
  const [symbol] = useLink<SymbolId>("symbol");
  const [range, setRange] = useLink<Range | null>("range");
  const quote = useQuote(symbol);
  const rows = useMemo(() => select(symbol, range, state.limit), [symbol, range, state.limit, quote]);
  if (!symbol) return <p className="st-blank">No symbol. Link this panel to a group, or pick a symbol in a watchlist.</p>;
  return (
    <>
      <div className="wb-toolhead">
        <strong>{symbol}</strong>
        <span>{range ? `${range.from} to ${range.to}` : `last ${state.limit} days`}</span>
        {range ? (
          <button className="wb-button" onClick={() => setRange(null)}>
            Clear range
          </button>
        ) : (
          <button className="wb-button" onClick={() => setState({ limit: state.limit === 60 ? 251 : 60 })}>
            {state.limit === 60 ? "Show all" : "Show 60"}
          </button>
        )}
        <button className="wb-button" onClick={() => downloadCsv(`${symbol}-bars.csv`, ["date", "open", "high", "low", "close", "volume"], rows.map((b) => [b.date, b.open, b.high, b.low, b.close, b.volume]))}>
          CSV
        </button>
      </div>
      <table className="wb-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Open</th>
            <th>High</th>
            <th>Low</th>
            <th>Close</th>
            <th>Volume</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((bar) => (
            <tr key={bar.date}>
              <td>{bar.date === TODAY ? `${bar.date} (live)` : bar.date}</td>
              <td>{price(bar.open)}</td>
              <td>{price(bar.high)}</td>
              <td>{price(bar.low)}</td>
              <td className={tone(bar.close - bar.open)}>{price(bar.close)}</td>
              <td>{whole(bar.volume)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export const bars = defineTool<State>({
  id: "bars",
  title: "Daily bars",
  glyph: "▤",
  category: "Trading",
  version: 1,
  stateSchema,
  defaultState: () => ({ limit: 60 }),
  links: ["symbol", "range"],
  component: Bars,
  describe: (state, { links }) => {
    const rows = select(links.symbol, links.range, state.limit);
    return {
      symbol: links.symbol ?? null,
      range: links.range ?? null,
      note: "Simulated data, newest first. Today's row is built from the live feed.",
      summary: summary([...rows].reverse()),
      firstRows: rows.slice(0, 5),
    };
  },
});
