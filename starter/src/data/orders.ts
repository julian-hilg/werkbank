import { SYMBOLS, hash, rng, round2, type SymbolId } from "../market/history";

/**
 * One hundred thousand invented order records, for the large-grid example.
 * They are generated once, on first use, from a fixed seed.
 */
export interface OrderRow {
  id: number;
  time: string;
  symbol: SymbolId;
  side: "buy" | "sell";
  qty: number;
  price: number;
  venue: string;
  trader: string;
  status: "filled" | "partial" | "cancelled" | "rejected";
}

export const ROW_COUNT = 100_000;
const VENUES = ["XNAS", "XNYS", "BATS", "ARCX", "IEXG", "EDGX"];
const TRADERS = ["ada", "ben", "chen", "dana", "eli", "fay", "gus", "hana"];
const STATUSES: OrderRow["status"][] = ["filled", "filled", "filled", "filled", "partial", "cancelled", "cancelled", "rejected"];
const BASE: Record<SymbolId, number> = { ALFA: 112, BRVO: 101, CHRL: 99, DLTA: 141, ECHO: 31, FXTR: 270, GOLF: 79, HOTL: 63 };

let cache: OrderRow[] | null = null;

export function orders(): OrderRow[] {
  if (cache) return cache;
  const random = rng(hash("orders"));
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const start = Date.UTC(2026, 0, 5, 14, 30);
  let clock = start;
  cache = Array.from({ length: ROW_COUNT }, (_, i) => {
    clock += Math.floor(random() * 9000);
    const symbol = pick(SYMBOLS);
    return {
      id: i + 1,
      time: new Date(clock).toISOString().replace("T", " ").slice(0, 19),
      symbol,
      side: random() < 0.5 ? "buy" : "sell",
      qty: Math.ceil(random() ** 2 * 50) * 100,
      price: round2(BASE[symbol] * (0.9 + random() * 0.2)),
      venue: pick(VENUES),
      trader: pick(TRADERS),
      status: pick(STATUSES),
    };
  });
  return cache;
}

export const COLUMNS: { key: keyof OrderRow; label: string; numeric?: boolean; width: number }[] = [
  { key: "id", label: "ID", numeric: true, width: 70 },
  { key: "time", label: "Time (UTC)", width: 150 },
  { key: "symbol", label: "Symbol", width: 70 },
  { key: "side", label: "Side", width: 56 },
  { key: "qty", label: "Qty", numeric: true, width: 70 },
  { key: "price", label: "Price", numeric: true, width: 80 },
  { key: "venue", label: "Venue", width: 64 },
  { key: "trader", label: "Trader", width: 70 },
  { key: "status", label: "Status", width: 86 },
];

export interface GridQuery {
  query: string;
  side: "all" | "buy" | "sell";
  sort: keyof OrderRow;
  descending: boolean;
}

/** Filter and sort. Pure, so the same call answers the screen, the export and an agent. */
export function selectOrders(q: GridQuery): OrderRow[] {
  const terms = q.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = orders().filter(
    (r) =>
      (q.side === "all" || r.side === q.side) &&
      terms.every((t) => r.symbol.toLowerCase() === t || r.venue.toLowerCase() === t || r.trader === t || r.status.startsWith(t) || String(r.id) === t),
  );
  const direction = q.descending ? -1 : 1;
  const key = q.sort;
  if (key !== "id" || q.descending) {
    rows.sort((a, b) => (a[key] < b[key] ? -direction : a[key] > b[key] ? direction : a.id - b.id));
  }
  return rows;
}
