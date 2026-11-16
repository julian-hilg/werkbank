import { useCallback, useSyncExternalStore } from "react";
import { feed, type FeedStatus, type Print, type Quote } from "./feed";
import type { SymbolId } from "./history";

/**
 * Live data for tools. Each hook subscribes only while its component is
 * mounted and visible: the shell suspends hidden tabs, so a panel behind
 * another tab costs nothing.
 */
export function useQuote(symbol: SymbolId | undefined): Quote | undefined {
  const subscribe = useCallback((fn: () => void) => (symbol ? feed.subscribe(`quote:${symbol}`, fn) : () => {}), [symbol]);
  return useSyncExternalStore(subscribe, () => (symbol ? feed.getQuote(symbol) : undefined));
}

export function useTape(symbol: SymbolId | undefined): Print[] {
  const subscribe = useCallback((fn: () => void) => (symbol ? feed.subscribe(`tape:${symbol}`, fn) : () => {}), [symbol]);
  return useSyncExternalStore(subscribe, () => (symbol ? feed.getTape(symbol) : EMPTY));
}
const EMPTY: Print[] = [];

/** Re-render whenever any quote changes. For views that span all symbols. */
export function useFeedVersion(): number {
  return useSyncExternalStore(subscribeAll, feed.getVersion);
}
const subscribeAll = (fn: () => void) => feed.subscribe("all", fn);

export function useFeedStatus(): FeedStatus {
  return useSyncExternalStore(subscribeStatus, feed.getStatus);
}
const subscribeStatus = (fn: () => void) => feed.subscribe("status", fn);
