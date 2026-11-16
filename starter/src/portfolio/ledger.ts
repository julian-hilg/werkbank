import { SYMBOLS, TODAY, history, round2, type SymbolId } from "../market/history";

/**
 * A paper-trading ledger: the list of fills is the only stored fact, and
 * positions, cash and P&L are always derived from it. Nothing here places a
 * real order.
 */
export interface Trade {
  id: number;
  /** ms since epoch */
  time: number;
  /** Trading day, YYYY-MM-DD */
  date: string;
  symbol: SymbolId;
  side: "buy" | "sell";
  qty: number;
  price: number;
  actor: "user" | "agent" | "seed";
}

export interface Position {
  symbol: SymbolId;
  qty: number;
  avgCost: number;
  /** Profit already locked in by sells, average-cost method. */
  realised: number;
}

export const START_CASH = 250_000;

/** Positions and cash after applying trades in order (average-cost method). */
export function book(trades: Trade[]): { positions: Map<SymbolId, Position>; cash: number; realised: number } {
  const positions = new Map<SymbolId, Position>();
  let cash = START_CASH;
  for (const t of trades) {
    const p = positions.get(t.symbol) ?? { symbol: t.symbol, qty: 0, avgCost: 0, realised: 0 };
    if (t.side === "buy") {
      positions.set(t.symbol, { ...p, qty: p.qty + t.qty, avgCost: (p.avgCost * p.qty + t.price * t.qty) / (p.qty + t.qty) });
      cash -= t.price * t.qty;
    } else {
      const qty = p.qty - t.qty;
      positions.set(t.symbol, { ...p, qty, avgCost: qty === 0 ? 0 : p.avgCost, realised: p.realised + (t.price - p.avgCost) * t.qty });
      cash += t.price * t.qty;
    }
  }
  const realised = [...positions.values()].reduce((sum, p) => sum + p.realised, 0);
  return { positions, cash, realised };
}

export interface Valuation {
  rows: (Position & { last: number; value: number; unrealised: number; day: number; weight: number })[];
  cash: number;
  equity: number;
  realised: number;
  unrealised: number;
  /** Total profit since the account started. */
  total: number;
  /** Change in equity since the previous close. */
  day: number;
}

/**
 * Mark the book to the given prices. `prevClose` and `tradesBeforeToday` give
 * the day's P&L: today's equity minus what the account was worth at the last close.
 */
export function valuation(
  trades: Trade[],
  last: (symbol: SymbolId) => number,
  prevClose: (symbol: SymbolId) => number,
  today: string = TODAY,
): Valuation {
  const now = book(trades);
  const before = book(trades.filter((t) => t.date < today));
  const held = [...now.positions.values()].filter((p) => p.qty !== 0 || p.realised !== 0);
  const invested = held.reduce((sum, p) => sum + p.qty * last(p.symbol), 0);
  const equity = now.cash + invested;
  const equityAtClose = before.cash + [...before.positions.values()].reduce((sum, p) => sum + p.qty * prevClose(p.symbol), 0);
  const rows = held.map((p) => {
    const price = last(p.symbol);
    const opening = before.positions.get(p.symbol)?.qty ?? 0;
    const todays = trades.filter((t) => t.date >= today && t.symbol === p.symbol);
    // Day P&L of one symbol: overnight holding moved from the close, plus today's fills moved from their price.
    const day = opening * (price - prevClose(p.symbol)) + todays.reduce((sum, t) => sum + (t.side === "buy" ? 1 : -1) * t.qty * (price - t.price), 0);
    return { ...p, last: price, value: p.qty * price, unrealised: p.qty * (price - p.avgCost), day, weight: equity ? (p.qty * price) / equity : 0 };
  });
  const unrealised = rows.reduce((sum, r) => sum + r.unrealised, 0);
  return { rows, cash: now.cash, equity, realised: now.realised, unrealised, total: equity - START_CASH, day: equity - equityAtClose };
}

/** End-of-day equity for every day of history, from the trades made up to that day. */
export function equityHistory(trades: Trade[]): { date: string; equity: number; pnl: number }[] {
  const dates = history(SYMBOLS[0]).map((b) => b.date);
  const closes = new Map(SYMBOLS.map((s) => [s, history(s)] as const));
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  return dates.map((date, i) => {
    const { positions, cash } = book(sorted.filter((t) => t.date <= date));
    const invested = [...positions.values()].reduce((sum, p) => sum + p.qty * closes.get(p.symbol)![i]!.close, 0);
    return { date, equity: round2(cash + invested), pnl: round2(cash + invested - START_CASH) };
  });
}

/** A starting book built at historical closes, so there is P&L to look at on first run. */
export function seedTrades(): Trade[] {
  const plan: [SymbolId, number, "buy" | "sell", number][] = [
    ["DLTA", 30, "buy", 120], ["ALFA", 45, "buy", 400], ["FXTR", 70, "buy", 90], ["ECHO", 95, "buy", 160],
    ["CHRL", 120, "buy", 900], ["ALFA", 150, "sell", 150], ["GOLF", 170, "buy", 250], ["DLTA", 200, "sell", 40],
    ["BRVO", 215, "buy", 110], ["GOLF", 235, "sell", 100],
  ];
  return plan.map(([symbol, index, side, qty], i) => {
    const bar = history(symbol)[index]!;
    return { id: i + 1, time: new Date(`${bar.date}T16:00:00`).getTime(), date: bar.date, symbol, side, qty, price: bar.close, actor: "seed" as const };
  });
}

export class OrderRejected extends Error {}

type Listener = () => void;
const KEY = "starter.ledger";

/** The ledger as an observable store, persisted in the browser. */
export class Ledger {
  private trades: Trade[];
  private listeners = new Set<Listener>();

  constructor(private storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null) {
    this.trades = [...seedTrades(), ...this.load()];
  }

  getTrades = (): Trade[] => this.trades;
  subscribe = (fn: Listener) => (this.listeners.add(fn), () => void this.listeners.delete(fn));

  /** Record a fill. Long-only and cash-only: no shorting, no borrowing. */
  fill(order: { symbol: SymbolId; side: "buy" | "sell"; qty: number; price: number; actor: "user" | "agent" }): Trade {
    if (!Number.isInteger(order.qty) || order.qty <= 0) throw new OrderRejected("Quantity must be a whole number above zero.");
    const { positions, cash } = book(this.trades);
    const held = positions.get(order.symbol)?.qty ?? 0;
    if (order.side === "sell" && order.qty > held) {
      throw new OrderRejected(`Cannot sell ${order.qty} ${order.symbol}: only ${held} held. Short selling is not enabled.`);
    }
    if (order.side === "buy" && order.qty * order.price > cash) {
      throw new OrderRejected(`Not enough cash: the order costs ${(order.qty * order.price).toFixed(2)}, cash is ${cash.toFixed(2)}.`);
    }
    const trade: Trade = { ...order, id: Math.max(0, ...this.trades.map((t) => t.id)) + 1, time: Date.now(), date: TODAY };
    this.trades = [...this.trades, trade];
    this.save();
    this.listeners.forEach((fn) => fn());
    return trade;
  }

  /** Forget every trade made here and go back to the seeded book. */
  reset(): void {
    this.trades = seedTrades();
    this.storage?.removeItem(KEY);
    this.listeners.forEach((fn) => fn());
  }

  private load(): Trade[] {
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) ?? "[]");
      return Array.isArray(raw) ? raw.filter((t) => t && typeof t.id === "number" && SYMBOLS.includes(t.symbol)) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.trades.filter((t) => t.actor !== "seed")));
    } catch {
      /* the trades then last for this page load only */
    }
  }
}

export const ledger = new Ledger(typeof localStorage === "undefined" ? null : localStorage);
