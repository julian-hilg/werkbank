import { copyText, type MenuItem, type Werkbank } from "@werkbank/framework";
import type { SymbolId } from "../market/history";

/** Menu entries for anything that stands for a symbol: a watchlist row, a position, a fill. */
export function symbolMenu(wb: Werkbank, symbol: SymbolId, select: (symbol: SymbolId) => void): MenuItem[] {
  /** Open a panel of its own on this symbol, not following any group. */
  const openOn = (toolId: string) => async () => {
    const result = await wb.run("panel.open", { toolId, link: null });
    if (result.ok) wb.publish(result.value as string, "symbol", symbol);
  };
  return [
    { label: `Select ${symbol} for this group`, run: () => select(symbol) },
    { separator: true },
    { label: "Open a chart on it", run: openOn("chart") },
    { label: "Open an order ticket on it", run: openOn("ticket") },
    { label: "Open its order book", run: openOn("depth") },
    { separator: true },
    { label: "Copy symbol", run: () => copyText(symbol) },
  ];
}
