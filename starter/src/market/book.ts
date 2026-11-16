import type { Quote } from "./feed";
import { hash, rng, round2 } from "./history";

export interface Level {
  price: number;
  size: number;
  /** Size of this level and all better ones. */
  cumulative: number;
}

/**
 * A synthetic order book around a quote: ten price levels a side whose sizes
 * are a deterministic function of the quote, so the same quote always shows
 * the same book. It is generated for display; the feed has no real depth.
 */
export function orderBook(quote: Quote, depth = 10): { bids: Level[]; asks: Level[] } {
  const random = rng(hash(quote.symbol) ^ Math.floor(quote.seq / 3));
  const tick = Math.max(0.01, round2(quote.last * 0.0002));
  const side = (start: number, step: number, first: number): Level[] => {
    let cumulative = 0;
    return Array.from({ length: depth }, (_, i) => {
      const size = i === 0 ? first : Math.round((300 + random() * 2600 * (1 + i * 0.25)) / 100) * 100;
      cumulative += size;
      return { price: round2(start + step * i * tick), size, cumulative };
    });
  };
  return { bids: side(quote.bid, -1, quote.bidSize), asks: side(quote.ask, 1, quote.askSize) };
}
