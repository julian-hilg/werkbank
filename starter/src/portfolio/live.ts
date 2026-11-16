import { useMemo, useSyncExternalStore } from "react";
import { feed } from "../market/feed";
import { useFeedVersion } from "../market/hooks";
import { ledger, valuation, type Trade, type Valuation } from "./ledger";

/** The book marked to the live feed. */
export const liveValuation = (): Valuation =>
  valuation(ledger.getTrades(), (s) => feed.getQuote(s).last, (s) => feed.getQuote(s).prevClose);

export function useTrades(): Trade[] {
  return useSyncExternalStore(ledger.subscribe, ledger.getTrades);
}

/** Re-computed on every fill and every price change. */
export function useValuation(): Valuation {
  const trades = useTrades();
  const version = useFeedVersion();
  return useMemo(() => liveValuation(), [trades, version]);
}

/**
 * Equity sampled once a second since the page loaded, for the session view of
 * the P&L panel. Sampling runs for the life of the page, independent of which
 * panels are open, so the line has no gaps when the panel is opened later.
 */
export interface Sample {
  time: number;
  pnl: number;
  day: number;
}
const MAX = 1800;
let samples: Sample[] = [];
const listeners = new Set<() => void>();

setInterval(() => {
  if (!feed.isLive()) return; // no point is recorded while prices are stale
  const v = liveValuation();
  samples = [...samples, { time: Date.now(), pnl: v.total, day: v.day }].slice(-MAX);
  listeners.forEach((fn) => fn());
}, 1000);

export function useSession(): Sample[] {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    () => samples,
  );
}
