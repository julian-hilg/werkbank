import { describe, expect, it } from "vitest";
import { history } from "../src/market/history";
import { Ledger, OrderRejected, START_CASH, book, equityHistory, seedTrades, valuation, type Trade } from "../src/portfolio/ledger";

const trade = (id: number, side: "buy" | "sell", qty: number, price: number, date = "2020-01-02"): Trade => ({
  id, time: id, date, symbol: "ALFA", side, qty, price, actor: "user",
});

describe("book", () => {
  it("averages cost on buys and realises profit on sells", () => {
    const { positions, cash, realised } = book([trade(1, "buy", 100, 10), trade(2, "buy", 100, 20), trade(3, "sell", 50, 30)]);
    const p = positions.get("ALFA")!;
    expect(p.qty).toBe(150);
    expect(p.avgCost).toBe(15);
    expect(realised).toBe(750); // 50 * (30 - 15)
    expect(cash).toBe(START_CASH - 1000 - 2000 + 1500);
  });

  it("keeps realised profit after a position is closed", () => {
    const { positions } = book([trade(1, "buy", 10, 10), trade(2, "sell", 10, 12)]);
    expect(positions.get("ALFA")).toMatchObject({ qty: 0, avgCost: 0, realised: 20 });
  });
});

describe("valuation", () => {
  const trades = [trade(1, "buy", 100, 10, "2020-01-02"), trade(2, "buy", 50, 13, "2020-01-03")];

  it("splits total P&L into realised and unrealised, and equity adds up", () => {
    const v = valuation(trades, () => 14, () => 12, "2020-01-03");
    expect(v.unrealised).toBeCloseTo(150 * 14 - (1000 + 650));
    expect(v.total).toBeCloseTo(v.realised + v.unrealised);
    expect(v.equity).toBeCloseTo(v.cash + 150 * 14);
  });

  it("computes day P&L from the previous close, and from the fill price for today's trades", () => {
    const v = valuation(trades, () => 14, () => 12, "2020-01-03");
    // 100 held overnight moved 12 -> 14; 50 bought today at 13 moved to 14.
    expect(v.day).toBeCloseTo(100 * 2 + 50 * 1);
    expect(v.rows[0]!.day).toBeCloseTo(v.day);
  });

  it("weights sum to the invested share of equity", () => {
    const v = valuation(trades, () => 14, () => 12, "2020-01-03");
    expect(v.rows.reduce((s, r) => s + r.weight, 0)).toBeCloseTo((150 * 14) / v.equity);
  });
});

describe("seeded book and history", () => {
  it("never sells more than it holds and never overdraws cash", () => {
    const sorted = [...seedTrades()].sort((a, b) => a.time - b.time);
    sorted.forEach((_, i) => {
      const { positions, cash } = book(sorted.slice(0, i + 1));
      expect(cash).toBeGreaterThanOrEqual(0);
      for (const p of positions.values()) expect(p.qty).toBeGreaterThanOrEqual(0);
    });
  });

  it("starts flat and ends at the book marked to the last close", () => {
    const curve = equityHistory(seedTrades());
    expect(curve[0]!.pnl).toBe(0);
    const v = valuation(seedTrades(), (s) => history(s).at(-1)!.close, (s) => history(s).at(-1)!.close);
    expect(curve.at(-1)!.equity).toBeCloseTo(v.equity, 1);
  });
});

describe("ledger", () => {
  it("rejects short sales and orders beyond cash, and leaves the book unchanged", () => {
    const ledger = new Ledger(null);
    const before = ledger.getTrades();
    expect(() => ledger.fill({ symbol: "HOTL", side: "sell", qty: 1, price: 10, actor: "user" })).toThrow(OrderRejected);
    expect(() => ledger.fill({ symbol: "HOTL", side: "buy", qty: 1_000_000, price: 10, actor: "user" })).toThrow(/Not enough cash/);
    expect(() => ledger.fill({ symbol: "HOTL", side: "buy", qty: 1.5, price: 10, actor: "user" })).toThrow(OrderRejected);
    expect(ledger.getTrades()).toBe(before);
  });

  it("records a fill and notifies subscribers", () => {
    const ledger = new Ledger(null);
    let calls = 0;
    ledger.subscribe(() => calls++);
    const fill = ledger.fill({ symbol: "HOTL", side: "buy", qty: 10, price: 10, actor: "agent" });
    expect(fill).toMatchObject({ symbol: "HOTL", qty: 10, actor: "agent" });
    expect(book(ledger.getTrades()).positions.get("HOTL")!.qty).toBe(10);
    expect(calls).toBe(1);
  });
});
