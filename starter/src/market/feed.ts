import { SYMBOLS, TODAY, history, profile, round2, type Bar, type SymbolId } from "./history";

/**
 * A simulated streaming market feed. It behaves like a real one: quotes and
 * trade prints arrive at irregular intervals, the connection can drop and
 * come back, and a quote that is not being updated is marked stale rather
 * than passed off as live. No network is involved; prices are a random walk
 * from each symbol's last historical close.
 */
export interface Quote {
  symbol: SymbolId;
  last: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  /** Time of the last update, ms since epoch. */
  time: number;
  /** Increases with every update; lets views flash on change. */
  seq: number;
  /** +1 if the last trade was above the previous one, -1 below, 0 unchanged. */
  tick: -1 | 0 | 1;
}

export interface Print {
  seq: number;
  time: number;
  symbol: SymbolId;
  price: number;
  size: number;
  side: "buy" | "sell";
}

export type FeedStatus = "connecting" | "live" | "paused" | "reconnecting";

const STEP_MS = 100;
const STEPS_PER_DAY = (6.5 * 3600 * 1000) / STEP_MS; // one trading session
const TAPE_LENGTH = 200;
const INTRADAY_LENGTH = 600;
const MINUTES_KEPT = 720;

type Listener = () => void;

export class SimulatedFeed {
  private quotes = new Map<SymbolId, Quote>();
  private tapes = new Map<SymbolId, Print[]>();
  /** Portfolio-wide heartbeat for views that aggregate across symbols. */
  private version = 0;
  private status: FeedStatus = "connecting";
  private listeners = new Map<string, Set<Listener>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private dropTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private random = Math.random;
  /** Per-symbol mean-reverting pressure, so moves come in runs like real order flow. */
  private pressure = new Map<SymbolId, number>();
  private intraday = new Map<SymbolId, { time: number; price: number }[]>();
  /** One-minute bars of the live session, built from the trade prints. */
  private minutes = new Map<SymbolId, Bar[]>();

  constructor() {
    const now = Date.now();
    for (const symbol of SYMBOLS) {
      const prevClose = history(symbol).at(-1)!.close;
      const spread = Math.max(0.01, round2(prevClose * 0.0004));
      this.quotes.set(symbol, {
        symbol, last: prevClose, bid: round2(prevClose - spread / 2), ask: round2(prevClose + spread / 2),
        bidSize: 300, askSize: 300, prevClose, open: prevClose, high: prevClose, low: prevClose,
        volume: 0, time: now, seq: 0, tick: 0,
      });
      this.tapes.set(symbol, []);
      this.pressure.set(symbol, 0);
      this.intraday.set(symbol, [{ time: now, price: prevClose }]);
      this.minutes.set(symbol, []);
    }
  }

  // ---- connection -----------------------------------------------------------

  /** Open the stream. Takes a moment, as a real connection would. */
  connect(): void {
    if (this.timer || this.status === "paused") return;
    this.setStatus("connecting");
    setTimeout(() => this.status === "connecting" && this.start(), 600);
  }

  private start(): void {
    this.setStatus("live");
    this.timer ??= setInterval(() => this.step(), STEP_MS);
    this.scheduleDrop();
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.dropTimer) clearTimeout(this.dropTimer);
    this.timer = this.dropTimer = null;
  }

  pause(): void {
    this.stop();
    this.setStatus("paused");
  }

  resume(): void {
    if (this.status !== "paused") return;
    this.status = "connecting";
    this.connect();
  }

  /** Simulate a dropped connection that recovers by itself. */
  drop(ms = 4000): void {
    if (this.status !== "live") return;
    this.stop();
    this.setStatus("reconnecting");
    setTimeout(() => this.status === "reconnecting" && this.start(), ms);
  }

  /** Whether the connection drops by itself now and then (a setting in the app). */
  autoDrop = true;

  private scheduleDrop(): void {
    if (!this.autoDrop) return;
    // An unprompted drop every two to five minutes keeps the stale path exercised.
    this.dropTimer = setTimeout(() => this.drop(2500 + this.random() * 3000), 120_000 + this.random() * 180_000);
  }

  private setStatus(status: FeedStatus): void {
    this.status = status;
    this.emit("status");
    this.emit("all"); // staleness changes how every quote should be shown
  }

  // ---- simulation -----------------------------------------------------------

  private step(): void {
    const now = Date.now();
    let changed = false;
    for (const symbol of SYMBOLS) {
      const { dailyVol, activity } = profile(symbol);
      if (this.random() > activity) continue;
      const q = this.quotes.get(symbol)!;
      const sigma = (dailyVol / Math.sqrt(STEPS_PER_DAY * activity)) * 6; // sped up so a session is watchable
      const pressure = this.pressure.get(symbol)! * 0.97 + (this.random() - 0.5) * 0.6;
      this.pressure.set(symbol, pressure);
      const mid = ((q.bid + q.ask) / 2) * (1 + sigma * (gauss(this.random) + pressure * 0.35));
      const spread = Math.max(0.01, round2(mid * (0.0003 + this.random() * 0.0004)));
      const bid = round2(mid - spread / 2);
      const ask = round2(Math.max(bid + 0.01, mid + spread / 2));
      const next: Quote = { ...q, bid, ask, bidSize: lot(this.random), askSize: lot(this.random), time: now, seq: ++this.seq, tick: 0 };

      // Not every quote update is a trade.
      if (this.random() < 0.55) {
        const side: Print["side"] = this.random() < 0.5 + pressure * 0.2 ? "buy" : "sell";
        const price = side === "buy" ? ask : bid;
        const size = lot(this.random);
        next.tick = price > q.last ? 1 : price < q.last ? -1 : 0;
        next.last = price;
        next.high = Math.max(q.high, price);
        next.low = Math.min(q.low, price);
        next.volume = q.volume + size;
        const tape = this.tapes.get(symbol)!;
        this.tapes.set(symbol, [{ seq: next.seq, time: now, symbol, price, size, side }, ...tape].slice(0, TAPE_LENGTH));
        const points = this.intraday.get(symbol)!;
        if (now - points.at(-1)!.time >= 1000) this.intraday.set(symbol, [...points, { time: now, price }].slice(-INTRADAY_LENGTH));
        this.addToMinute(symbol, now, price, size);
        this.emit(`tape:${symbol}`);
      }
      this.quotes.set(symbol, next);
      this.emit(`quote:${symbol}`);
      changed = true;
    }
    if (changed) {
      this.version++;
      this.emit("all");
    }
  }

  private addToMinute(symbol: SymbolId, now: number, price: number, size: number): void {
    const bars = this.minutes.get(symbol)!;
    const time = Math.floor(now / 60_000) * 60_000;
    const last = bars[bars.length - 1];
    if (last && last.time === time) {
      bars[bars.length - 1] = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price, volume: last.volume + size };
      this.minutes.set(symbol, [...bars]);
    } else {
      const open = last?.close ?? price;
      this.minutes.set(symbol, [...bars, { date: TODAY, time, open, high: Math.max(open, price), low: Math.min(open, price), close: price, volume: size }].slice(-MINUTES_KEPT));
    }
  }

  // ---- reading --------------------------------------------------------------

  getStatus = (): FeedStatus => this.status;
  getVersion = (): number => this.version;
  getQuote = (symbol: SymbolId): Quote => this.quotes.get(symbol)!;
  getTape = (symbol: SymbolId): Print[] => this.tapes.get(symbol)!;
  getIntraday = (symbol: SymbolId) => this.intraday.get(symbol)!;
  /** True while quotes are current. A stale price must not be shown as live. */
  isLive = (): boolean => this.status === "live";

  /** Today's bar as built so far from the stream. */
  liveBar(symbol: SymbolId): Bar {
    const q = this.getQuote(symbol);
    return { date: TODAY, open: q.open, high: q.high, low: q.low, close: q.last, volume: q.volume };
  }

  /** One-minute bars of the live session so far. */
  liveMinutes = (symbol: SymbolId): Bar[] => this.minutes.get(symbol)!;

  /** History plus the bar of the live session. */
  bars(symbol: SymbolId): Bar[] {
    return [...history(symbol), this.liveBar(symbol)];
  }

  /**
   * Subscribe to a channel: "status", "all" (any quote changed),
   * "quote:SYMBOL" or "tape:SYMBOL".
   */
  subscribe(channel: string, listener: Listener): () => void {
    let set = this.listeners.get(channel);
    if (!set) this.listeners.set(channel, (set = new Set()));
    set.add(listener);
    return () => void set.delete(listener);
  }

  private emit(channel: string): void {
    this.listeners.get(channel)?.forEach((fn) => fn());
  }
}

const gauss = (random: () => number) => random() + random() + random() + random() - 2;
const lot = (random: () => number) => Math.max(100, Math.round((random() ** 2 * 2400) / 100) * 100);

/** The app's one feed. Tools read it through the hooks in `./hooks`. */
export const feed = new SimulatedFeed();
