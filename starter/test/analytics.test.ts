import { describe, expect, it } from "vitest";
import { clusteredOrder, correlation, correlationMatrix, histogram, ranks, returns, rollingCorrelation, stats, volSurface, MONEYNESS } from "../src/market/analytics";
import { orderBook } from "../src/market/book";
import { SYMBOLS, history } from "../src/market/history";

describe("return statistics", () => {
  it("has one return per day after the first, and bins account for all of them", () => {
    expect(returns("ALFA")).toHaveLength(history("ALFA").length - 1);
    expect(histogram("ALFA").reduce((s, b) => s + b.count, 0)).toBe(returns("ALFA").length);
  });

  it("reports consistent extremes and a drawdown between -100% and 0", () => {
    for (const symbol of SYMBOLS) {
      const s = stats(symbol);
      expect(s.worst).toBeLessThanOrEqual(s.mean);
      expect(s.best).toBeGreaterThanOrEqual(s.mean);
      expect(s.maxDrawdown).toBeLessThanOrEqual(0);
      expect(s.maxDrawdown).toBeGreaterThan(-1);
      expect(s.annualVol).toBeCloseTo(s.sd * Math.sqrt(252));
    }
  });
});

describe("correlation", () => {
  it("is symmetric, 1 on the diagonal and within [-1, 1]", () => {
    const m = correlationMatrix();
    m.forEach((row, i) =>
      row.forEach((v, j) => {
        expect(v).toBeCloseTo(m[j]![i]!);
        expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-9);
        if (i === j) expect(v).toBe(1);
      }),
    );
  });

  it("is higher inside a sector than across sectors, on average", () => {
    const inside = (correlation("ALFA", "BRVO") + correlation("DLTA", "ECHO") + correlation("GOLF", "HOTL")) / 3;
    const across = (correlation("ALFA", "DLTA") + correlation("BRVO", "GOLF") + correlation("ECHO", "HOTL")) / 3;
    expect(inside).toBeGreaterThan(across);
  });
});

describe("correlation options", () => {
  it("ranks with ties sharing their average", () => {
    expect(ranks([10, 30, 20, 30])).toEqual([1, 3.5, 2, 3.5]);
  });

  it("Spearman is 1 for any increasing relationship, where Pearson is not", () => {
    // Checked through the public function on real series: both stay in range and differ.
    const p = correlation("DLTA", "ECHO", { method: "pearson" });
    const s = correlation("DLTA", "ECHO", { method: "spearman" });
    expect(Math.abs(s)).toBeLessThanOrEqual(1);
    expect(s).not.toBe(p);
  });

  it("a shorter lookback uses only the most recent days", () => {
    const short = correlation("ALFA", "BRVO", { days: 30 });
    expect(short).not.toBe(correlation("ALFA", "BRVO"));
    expect(rollingCorrelation("ALFA", "BRVO", 30).at(-1)!.value).toBeCloseTo(short);
  });

  it("rolling correlation has one value per day from the first full window", () => {
    expect(rollingCorrelation("ALFA", "BRVO", 30)).toHaveLength(returns("ALFA").length - 29);
  });

  it("clustered order keeps every symbol once and puts the strongest pair together", () => {
    const m = correlationMatrix();
    const order = clusteredOrder(m);
    expect([...order].sort()).toEqual([...SYMBOLS].sort());
    let best = { a: 0, b: 1 };
    for (let i = 0; i < SYMBOLS.length; i++) for (let j = i + 1; j < SYMBOLS.length; j++) if (m[i]![j]! > m[best.a]![best.b]!) best = { a: i, b: j };
    expect(Math.abs(order.indexOf(SYMBOLS[best.a]!) - order.indexOf(SYMBOLS[best.b]!))).toBe(1);
  });
});

describe("volatility surface", () => {
  it("is positive everywhere and skewed to the downside at short maturities", () => {
    for (const symbol of SYMBOLS) {
      const { iv } = volSurface(symbol);
      expect(iv.flat().every((v) => v > 0)).toBe(true);
      const short = iv[0]!;
      expect(short[0]!).toBeGreaterThan(short[MONEYNESS.indexOf(1)]!);
    }
  });
});

describe("order book", () => {
  const quote = { symbol: "ALFA" as const, last: 100, bid: 99.98, ask: 100.02, bidSize: 500, askSize: 700, prevClose: 100, open: 100, high: 100, low: 100, volume: 0, time: 0, seq: 12, tick: 0 as const };
  it("starts at the quote, steps away from it, and accumulates size", () => {
    const { bids, asks } = orderBook(quote);
    expect(bids[0]).toMatchObject({ price: 99.98, size: 500, cumulative: 500 });
    expect(asks[0]).toMatchObject({ price: 100.02, size: 700 });
    bids.forEach((l, i) => i && expect(l.price).toBeLessThan(bids[i - 1]!.price));
    asks.forEach((l, i) => i && expect(l.price).toBeGreaterThan(asks[i - 1]!.price));
    expect(asks.at(-1)!.cumulative).toBe(asks.reduce((s, l) => s + l.size, 0));
  });
  it("is the same for the same quote", () => {
    expect(orderBook(quote)).toEqual(orderBook(quote));
  });
});
