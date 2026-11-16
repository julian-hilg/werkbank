/**
 * Synthetic daily history. Symbols are invented and prices come from a seeded
 * random walk, so the shape of each series is the same on every run. The
 * series ends on the last business day before today; the live feed continues
 * from its final close. Replace this module with your project's data service.
 */
export const SYMBOLS = ["ALFA", "BRVO", "CHRL", "DLTA", "ECHO", "FXTR", "GOLF", "HOTL"] as const;
export type SymbolId = (typeof SYMBOLS)[number];
export const isSymbol = (value: unknown): value is SymbolId => SYMBOLS.includes(value as SymbolId);

export interface Bar {
  /** Trading day, YYYY-MM-DD. */
  date: string;
  /** Start of the bar, ms since epoch. Set on intraday bars. */
  time?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Range {
  from: string;
  to: string;
}

export const HISTORY_DAYS = 250;

export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const hash = (text: string) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
export const round2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isBusinessDay = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6;

/** Today's date, used as the label of the live session's bar. */
export const TODAY = iso(new Date());

/** The last `HISTORY_DAYS` business days before today, oldest first. */
const DATES: string[] = (() => {
  const out: string[] = [];
  const day = new Date();
  while (out.length < HISTORY_DAYS) {
    day.setDate(day.getDate() - 1);
    if (isBusinessDay(day)) out.unshift(iso(day));
  }
  return out;
})();

/** Invented sectors, so that symbols move together in groups as real ones do. */
export const SECTORS = ["Industrials", "Technology", "Energy"] as const;
const SECTOR_OF: Record<SymbolId, number> = { ALFA: 0, BRVO: 0, CHRL: 0, DLTA: 1, ECHO: 1, FXTR: 1, GOLF: 2, HOTL: 2 };
export const sectorOf = (symbol: SymbolId) => SECTORS[SECTOR_OF[symbol]]!;

/** Per-symbol character: daily volatility, market sensitivity and how often it trades. */
export function profile(symbol: SymbolId): { dailyVol: number; activity: number; beta: number } {
  const random = rng(hash(symbol) ^ 0x51ed);
  return { dailyVol: 0.008 + random() * 0.02, activity: 0.15 + random() * 0.55, beta: 0.5 + random() * 1.1 };
}

const noise = (random: () => number) => random() + random() + random() - 1.5;

/** Daily moves shared by every symbol (the market) and by each sector. */
const FACTORS = (() => {
  const market = rng(0x6d61726b);
  const sector = SECTORS.map((_, i) => rng(0x73656300 + i));
  return DATES.map(() => ({ market: noise(market) * 0.009, sector: sector.map((r) => noise(r) * 0.007) }));
})();

const cache = new Map<string, Bar[]>();

export function history(symbol: SymbolId): Bar[] {
  const hit = cache.get(symbol);
  if (hit) return hit;
  const random = rng(hash(symbol));
  const drift = (random() - 0.45) * 0.0015;
  const { dailyVol: vol, beta } = profile(symbol);
  let close = 20 + random() * 180;
  const bars = DATES.map((date, i) => {
    const open = close * (1 + (random() - 0.5) * vol * 0.6);
    const shared = beta * FACTORS[i]!.market + FACTORS[i]!.sector[SECTOR_OF[symbol]]!;
    close = Math.max(1, open * (1 + drift + shared + noise(random) * vol * 0.7));
    const high = Math.max(open, close) * (1 + random() * vol * 0.5);
    const low = Math.min(open, close) * (1 - random() * vol * 0.5);
    return {
      date, open: round2(open), high: round2(high), low: round2(low), close: round2(close),
      volume: Math.round(200_000 + random() * 1_800_000),
    };
  });
  cache.set(symbol, bars);
  return bars;
}

export function inRange<T extends { date: string }>(rows: T[], range: Range | null | undefined): T[] {
  return range ? rows.filter((r) => r.date >= range.from && r.date <= range.to) : rows;
}

export function summary(bars: Bar[]) {
  const first = bars[0];
  const last = bars[bars.length - 1];
  if (!first || !last) return null;
  return {
    from: first.date,
    to: last.date,
    bars: bars.length,
    firstClose: first.close,
    lastClose: last.close,
    changePct: round2((last.close / first.close - 1) * 100),
    high: Math.max(...bars.map((b) => b.high)),
    low: Math.min(...bars.map((b) => b.low)),
  };
}
