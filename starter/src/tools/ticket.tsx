import { defineTool, useLink, useSetting, useToolState, useWerkbank } from "@werkbank/framework";
import { useState } from "react";
import { z } from "zod";
import { feed } from "../market/feed";
import { useFeedStatus, useQuote } from "../market/hooks";
import { isSymbol, type SymbolId } from "../market/history";
import { book, type Trade } from "../portfolio/ledger";
import { useTrades } from "../portfolio/live";
import { price, whole } from "./format";

const stateSchema = z.object({ side: z.enum(["buy", "sell"]), qty: z.number().int().min(1).max(100_000) });
type State = z.infer<typeof stateSchema>;

function Ticket() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const [symbol] = useLink<SymbolId>("symbol");
  const quote = useQuote(symbol);
  const status = useFeedStatus();
  const trades = useTrades();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [defaultQty] = useSetting<number>("trading.defaultQuantity");
  if (!symbol || !quote) return <p className="st-blank">No symbol. Link this panel to a group, or pick a symbol in a watchlist.</p>;

  const live = status === "live";
  const { positions, cash } = book(trades);
  const held = positions.get(symbol)?.qty ?? 0;
  const fillPrice = state.side === "buy" ? quote.ask : quote.bid;
  const submit = async () => {
    const result = await wb.run("order.place", { symbol, side: state.side, qty: state.qty });
    if (result.ok) {
      const t = result.value as Trade;
      setMessage({ ok: true, text: `Filled: ${t.side} ${whole(t.qty)} ${t.symbol} at ${price(t.price)}.` });
    } else setMessage({ ok: false, text: result.error });
  };

  return (
    <form
      className="st-ticket"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="wb-field">
        <span>Symbol</span>
        <strong>{symbol}</strong>
      </div>
      <div className="wb-field">
        <span>Bid / ask</span>
        <span className={`wb-num ${live ? "" : "wb-stale"}`}>
          {price(quote.bid)} / {price(quote.ask)}
          {!live && <span className="wb-badge" data-tone="warn" style={{ marginLeft: 6 }}>stale</span>}
        </span>
      </div>
      <div className="wb-field">
        <span>Side</span>
        <span className="wb-segment" role="group" aria-label="Side">
          {(["buy", "sell"] as const).map((side) => (
            <button key={side} type="button" className="wb-button" aria-pressed={state.side === side} onClick={() => setState({ ...state, side })}>
              {side === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </span>
      </div>
      <div className="wb-field">
        <label htmlFor={`qty-${symbol}`}>Quantity</label>
        <input
          id={`qty-${symbol}`}
          className="wb-input wb-num"
          type="number"
          min={1}
          step={1}
          value={state.qty}
          onChange={(e) => {
            const qty = Math.round(Number(e.target.value));
            if (qty >= 1 && qty <= 100_000) setState({ ...state, qty });
          }}
        />
      </div>
      {state.qty !== defaultQty && (
        <div className="wb-field">
          <span />
          <button type="button" className="st-linkish" onClick={() => setState({ ...state, qty: defaultQty })}>
            use the default quantity ({whole(defaultQty)})
          </button>
        </div>
      )}
      <div className="wb-field">
        <span>Estimate</span>
        <span className="wb-num">
          {whole(state.qty * fillPrice)} at {price(fillPrice)}
        </span>
      </div>
      <div className="wb-field">
        <span>Held / cash</span>
        <span className="wb-num">
          {whole(held)} / {whole(cash)}
        </span>
      </div>
      <button className="wb-button st-submit" type="submit" disabled={!live}>
        {live ? `${state.side === "buy" ? "Buy" : "Sell"} ${whole(state.qty)} ${symbol} (paper)` : `Feed ${status}: orders are disabled`}
      </button>
      {message && (
        <p className={message.ok ? "wb-hint" : "wb-hint wb-warn"} role="status">
          {message.text}
        </p>
      )}
      <p className="wb-hint">Paper trading on simulated prices. Buys fill at the ask, sells at the bid.</p>
    </form>
  );
}

export const ticket = defineTool<State>({
  id: "ticket",
  title: "Order ticket",
  glyph: "⇄",
  category: "Trading",
  version: 1,
  stateSchema,
  defaultState: () => ({ side: "buy", qty: 100 }),
  links: ["symbol"],
  component: Ticket,
  describe: (state, { links }) => {
    const symbol = isSymbol(links.symbol) ? links.symbol : null;
    const quote = symbol ? feed.getQuote(symbol) : null;
    return {
      symbol,
      draft: state,
      quote: quote && { bid: quote.bid, ask: quote.ask, live: feed.isLive() },
      note: "A draft only. Orders are placed with the order.place command, which is paper trading on simulated prices.",
    };
  },
});
