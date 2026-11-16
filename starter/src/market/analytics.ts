import { SYMBOLS, history, profile, hash, rng, type SymbolId } from "./history";

/**
 * Derived statistics over the synthetic history. Everything here is a pure
 * function of the data, so it is unit-tested and agents can be given the
 * numbers behind each chart.
 */
export const returns = (symbol: SymbolId): number[] => {
  const bars = history(symbol);
  return bars.slice(1).map((b, i) => b.close / bars[i]!.close - 1);
};

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const TRADING_DAYS = 252;

export interface Stats {
  mean: number;
  /** Daily standard deviation. */
  sd: number;
  annualReturn: number;
  annualVol: number;
  skew: number;
  /** Excess kurtosis: 0 for a normal distribution. */
  kurtosis: number;
  worst: number;
  best: number;
  maxDrawdown: number;
}

export function stats(symbol: SymbolId): Stats {
  const r = returns(symbol);
  const m = mean(r);
  const sd = Math.sqrt(mean(r.map((x) => (x - m) ** 2)));
  const z = r.map((x) => (x - m) / sd);
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const bar of history(symbol)) {
    peak = Math.max(peak, bar.close);
    maxDrawdown = Math.min(maxDrawdown, bar.close / peak - 1);
  }
  return {
    mean: m, sd,
    annualReturn: m * TRADING_DAYS,
    annualVol: sd * Math.sqrt(TRADING_DAYS),
    skew: mean(z.map((x) => x ** 3)),
    kurtosis: mean(z.map((x) => x ** 4)) - 3,
    worst: Math.min(...r), best: Math.max(...r), maxDrawdown,
  };
}

/** Counts of daily returns in equal-width bins centred on zero. */
export function histogram(symbol: SymbolId, bins = 31): { lo: number; hi: number; count: number }[] {
  const r = returns(symbol);
  const extent = Math.max(...r.map(Math.abs)) * 1.001;
  const width = (2 * extent) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ lo: -extent + i * width, hi: -extent + (i + 1) * width, count: 0 }));
  for (const x of r) out[Math.min(bins - 1, Math.floor((x + extent) / width))]!.count++;
  return out;
}

export type CorrelationMethod = "pearson" | "spearman";
export interface CorrelationOptions {
  /** Use only the most recent this-many daily returns. */
  days?: number;
  /** Pearson measures linear co-movement; Spearman uses ranks, so it ignores how large the moves were. */
  method?: CorrelationMethod;
}

/** Ranks from 1, with ties sharing their average rank. */
export function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let k = i; k <= j; k++) out[order[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

function pearson(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

const measure = (x: number[], y: number[], method: CorrelationMethod) => (method === "spearman" ? pearson(ranks(x), ranks(y)) : pearson(x, y));

export function correlation(a: SymbolId, b: SymbolId, { days, method = "pearson" }: CorrelationOptions = {}): number {
  if (a === b) return 1;
  const x = returns(a);
  const y = returns(b);
  return measure(days ? x.slice(-days) : x, days ? y.slice(-days) : y, method);
}

export const correlationMatrix = (options: CorrelationOptions = {}): number[][] => SYMBOLS.map((a) => SYMBOLS.map((b) => correlation(a, b, options)));

/** Correlation over a moving window, one value per day from the first full window. */
export function rollingCorrelation(a: SymbolId, b: SymbolId, window: number, method: CorrelationMethod = "pearson"): { date: string; value: number }[] {
  const x = returns(a);
  const y = returns(b);
  const dates = history(a).slice(1).map((bar) => bar.date);
  const out: { date: string; value: number }[] = [];
  for (let end = window; end <= x.length; end++) out.push({ date: dates[end - 1]!, value: measure(x.slice(end - window, end), y.slice(end - window, end), method) });
  return out;
}

/**
 * An order that puts strongly related symbols next to each other: start from
 * the most correlated pair, then keep adding the symbol most correlated with
 * either end of the chain.
 */
export function clusteredOrder(matrix: number[][]): SymbolId[] {
  const n = SYMBOLS.length;
  let best: [number, number] = [0, 1];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (matrix[i]![j]! > matrix[best[0]]![best[1]]!) best = [i, j];
  const chain = [...best];
  while (chain.length < n) {
    let pick = { index: -1, value: -Infinity, front: false };
    for (let k = 0; k < n; k++) {
      if (chain.includes(k)) continue;
      const toFront = matrix[k]![chain[0]!]!;
      const toBack = matrix[k]![chain[chain.length - 1]!]!;
      if (Math.max(toFront, toBack) > pick.value) pick = { index: k, value: Math.max(toFront, toBack), front: toFront > toBack };
    }
    if (pick.front) chain.unshift(pick.index);
    else chain.push(pick.index);
  }
  return chain.map((i) => SYMBOLS[i]!);
}

// ---- implied volatility surface ---------------------------------------------

export const EXPIRIES = [7, 14, 30, 60, 90, 180, 365] as const;
export const MONEYNESS = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3] as const;

/**
 * A parametric volatility surface: level from the symbol's realised
 * volatility, a downward skew that flattens with maturity, and a smile.
 * It is a formula with invented parameters, not a fit to option quotes.
 */
export function volSurface(symbol: SymbolId): { expiries: readonly number[]; moneyness: readonly number[]; iv: number[][]; atm: number[] } {
  const random = rng(hash(symbol) ^ 0x766f6c);
  const level = profile(symbol).dailyVol * Math.sqrt(TRADING_DAYS) * (1.05 + random() * 0.2);
  const skew = -(0.08 + random() * 0.14);
  const smile = 0.25 + random() * 0.35;
  const termSlope = (random() - 0.35) * 0.12;
  const iv = EXPIRIES.map((days) => {
    const t = days / 365;
    const atm = level * (1 + termSlope * Math.log(t * 12 + 0.3));
    return MONEYNESS.map((m) => {
      const k = Math.log(m);
      return Math.max(0.03, atm + (skew * k) / Math.sqrt(t + 0.08) + (smile * k * k) / Math.sqrt(t + 0.15));
    });
  });
  return { expiries: EXPIRIES, moneyness: MONEYNESS, iv, atm: iv.map((row) => row[MONEYNESS.indexOf(1)]!) };
}
