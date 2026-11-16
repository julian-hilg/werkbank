import { Highlight, SearchBox } from "@werkbank/framework";
import { feed } from "../market/feed";
import { SYMBOLS, history, sectorOf, type SymbolId } from "../market/history";
import { pct, price, tone } from "./format";

/** The last sixty closes as a small line. */
export function Sparkline({ symbol }: { symbol: SymbolId }) {
  const closes = history(symbol).slice(-60).map((b) => b.close);
  const low = Math.min(...closes);
  const span = Math.max(...closes) - low || 1;
  const points = closes.map((c, i) => `${(i / (closes.length - 1)) * 200},${46 - ((c - low) / span) * 42}`).join(" ");
  return (
    <svg className="st-spark" viewBox="0 0 200 50" preserveAspectRatio="none" role="img" aria-label={`${symbol}, last 60 closes`}>
      <polyline points={points} fill="none" stroke="var(--wb-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** What the search shows about a symbol before it is chosen. */
export function SymbolPreview({ symbol }: { symbol: SymbolId }) {
  const q = feed.getQuote(symbol);
  const change = q.last / q.prevClose - 1;
  return (
    <>
      <h4>
        {symbol} <span className="wb-dim">{sectorOf(symbol)}</span>
      </h4>
      <p className="wb-num">
        {price(q.last)} <span className={tone(change)}>{pct(change)}</span>
      </p>
      <Sparkline symbol={symbol} />
      <p className="wb-dim">Last 60 closes, simulated. Bid {price(q.bid)}, ask {price(q.ask)}.</p>
    </>
  );
}

const ITEMS = SYMBOLS.map((s) => ({ id: s, label: s, hint: sectorOf(s) }));

/**
 * A search field for the symbol a panel shows. Type part of a ticker or a
 * sector; the highlighted result is previewed beside the list. Choosing one
 * sets it for the panel's whole link group, like clicking a row in the watchlist.
 */
export function SymbolSearch({ symbol, onPick }: { symbol: SymbolId | undefined; onPick: (symbol: SymbolId) => void }) {
  return (
    <SearchBox
      className="st-search-input"
      aria-label="Symbol"
      placeholder="Symbol"
      value={symbol ?? ""}
      items={ITEMS}
      onPick={(item) => onPick(item.id)}
      preview={(item) => <SymbolPreview symbol={item.id} />}
      renderItem={(item, query) => (
        <>
          <strong className="st-search-symbol">
            <Highlight text={item.label} query={query} />
          </strong>
          <span className="wb-option-label wb-dim">
            <Highlight text={item.hint} query={query} />
          </span>
          <span className="wb-num">{price(feed.getQuote(item.id).last)}</span>
        </>
      )}
    />
  );
}
