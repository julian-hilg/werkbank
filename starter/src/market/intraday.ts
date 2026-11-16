import { feed } from "./feed";
import { hash, history, rng, round2, type Bar, type SymbolId } from "./history";

/**
 * Minute bars. Past sessions are synthesised from each day's daily bar so the
 * two agree exactly: the first minute opens at the day's open, the last closes
 * at its close, and the session's high and low are the daily high and low. The
 * current session's minutes come from the live feed.
 */
export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "1D"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
const MINUTES: Record<Exclude<Timeframe, "1D">, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60 };

export const SESSION_MINUTES = 390; // 09:30 to 16:00
const SESSIONS_KEPT = 5;
const cache = new Map<string, Bar[]>();

function session(symbol: SymbolId, day: Bar): Bar[] {
  const random = rng(hash(`${symbol}:${day.date}`));
  const n = SESSION_MINUTES;
  // A random walk pinned at both ends (a bridge), added to the straight line from open to close.
  const walk = [0];
  for (let i = 1; i <= n; i++) walk.push(walk[i - 1]! + (random() + random() - 1));
  const bridge = walk.map((w, i) => w - (i / n) * walk[n]!);
  const line = (i: number) => day.open + ((day.close - day.open) * i) / n;
  // Scale the bumps above and below the line separately so they just reach the day's high and low.
  let up = Infinity;
  let down = Infinity;
  bridge.forEach((b, i) => {
    if (b > 0) up = Math.min(up, (day.high - line(i)) / b);
    if (b < 0) down = Math.min(down, (line(i) - day.low) / -b);
  });
  const path = bridge.map((b, i) => line(i) + b * (b > 0 ? up : down));
  // Rounding and the pinned ends can leave the extremes a cent short: place them exactly.
  const interior = path.slice(1, n);
  path[1 + interior.indexOf(Math.max(...interior))] = day.high;
  path[1 + interior.indexOf(Math.min(...path.slice(1, n)))] = day.low;
  path[n] = day.close;

  // Volume is heavier at the open and the close, as on a real exchange.
  const weights = Array.from({ length: n }, (_, i) => 1 + 2.2 * (2 * (i / (n - 1)) - 1) ** 2 + random() * 0.6);
  const total = weights.reduce((s, w) => s + w, 0);
  const start = new Date(`${day.date}T09:30:00`).getTime();
  const wick = (day.high - day.low) * 0.004;
  return Array.from({ length: n }, (_, i) => {
    const open = round2(path[i]!);
    const close = round2(path[i + 1]!);
    return {
      date: day.date,
      time: start + i * 60_000,
      open,
      close,
      high: round2(Math.min(day.high, Math.max(open, close) + random() * wick)),
      low: round2(Math.max(day.low, Math.min(open, close) - random() * wick)),
      volume: Math.round((day.volume * weights[i]!) / total),
    };
  });
}

/** Minute bars of the last few completed sessions. */
export function minuteHistory(symbol: SymbolId): Bar[] {
  const hit = cache.get(symbol);
  if (hit) return hit;
  const bars = history(symbol).slice(-SESSIONS_KEPT).flatMap((day) => session(symbol, day));
  cache.set(symbol, bars);
  return bars;
}

/** Merge minute bars into bars of `minutes` length, aligned to the clock. */
export function aggregate(bars: Bar[], minutes: number): Bar[] {
  if (minutes <= 1) return bars;
  const size = minutes * 60_000;
  const out: Bar[] = [];
  let bucket = NaN;
  for (const bar of bars) {
    const key = Math.floor(bar.time! / size);
    const last = out[out.length - 1];
    // A new day always starts a new bar, even if the clock bucket happens to match.
    if (last && key === bucket && last.date === bar.date) {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.volume += bar.volume;
    } else {
      out.push({ ...bar, time: key * size });
      bucket = key;
    }
  }
  return out;
}

/** Every bar available for a symbol at a timeframe, oldest first, ending with the live one. */
export function series(symbol: SymbolId, timeframe: Timeframe): Bar[] {
  if (timeframe === "1D") return feed.bars(symbol);
  return aggregate([...minuteHistory(symbol), ...feed.liveMinutes(symbol)], MINUTES[timeframe]);
}

/** How a bar is named in readouts and exports. */
export const barLabel = (bar: Bar): string =>
  bar.time === undefined ? bar.date : `${bar.date} ${new Date(bar.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
