import { defineTool, useLink, useToolState } from "@werkbank/framework";
import { z } from "zod";
import { feed } from "../market/feed";
import { useFeedStatus, useFeedVersion } from "../market/hooks";
import { SYMBOLS, history, sectorOf, type SymbolId } from "../market/history";
import { pct, price, tone } from "./format";

const stateSchema = z.object({ span: z.enum(["session", "month"]) });
type State = z.infer<typeof stateSchema>;

/** A line with no axes: the shape of the move is the message, the number beside it is the value. */
function Spark({ values, base }: { values: number[]; base: number }) {
  if (values.length < 2) return <svg className="st-spark" />;
  const lo = Math.min(...values, base);
  const hi = Math.max(...values, base);
  const x = (i: number) => (i / (values.length - 1)) * 100;
  const y = (v: number) => 28 - ((v - lo) / (hi - lo || 1)) * 26;
  return (
    <svg className="st-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <line x1={0} x2={100} y1={y(base)} y2={y(base)} className="st-gridline" vectorEffect="non-scaling-stroke" strokeDasharray="2 2" />
      <polyline fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--wb-accent)" }} points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
    </svg>
  );
}

const series = (symbol: SymbolId, span: State["span"]) =>
  span === "session"
    ? { values: feed.getIntraday(symbol).map((p) => p.price), base: feed.getQuote(symbol).prevClose }
    : { values: [...history(symbol).slice(-21).map((b) => b.close), feed.getQuote(symbol).last], base: history(symbol).at(-22)!.close };

function Monitor() {
  const [state, setState] = useToolState<State>();
  const [symbol, setSymbol] = useLink<SymbolId>("symbol");
  useFeedVersion();
  const stale = useFeedStatus() !== "live";
  return (
    <>
      <div className="wb-toolhead">
        <strong>Market monitor</strong>
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="Period">
          {(["session", "month"] as const).map((span) => (
            <button key={span} className="wb-button" aria-pressed={state.span === span} onClick={() => setState({ span })}>
              {span === "session" ? "This session" : "One month"}
            </button>
          ))}
        </span>
      </div>
      <div className={`st-monitor ${stale ? "wb-stale" : ""}`}>
        {SYMBOLS.map((s) => {
          const { values, base } = series(s, state.span);
          const q = feed.getQuote(s);
          const change = q.last / base - 1;
          return (
            <button key={s} className="st-monitor-card" aria-pressed={s === symbol} onClick={() => setSymbol(s)}>
              <span className="st-monitor-head">
                <strong>{s}</strong>
                <span className="wb-num">{price(q.last)}</span>
              </span>
              <Spark values={values} base={base} />
              <span className="st-monitor-head">
                <span className="st-dim">{sectorOf(s)}</span>
                <span className={`wb-num ${s === symbol ? "" : (tone(change) ?? "")}`}>{pct(change)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export const monitorTool = defineTool<State>({
  id: "monitor",
  title: "Market monitor",
  glyph: "⌇",
  category: "Trading",
  version: 1,
  stateSchema,
  defaultState: () => ({ span: "session" }),
  links: ["symbol"],
  component: Monitor,
  describe: (state) => ({
    span: state.span,
    feed: feed.getStatus(),
    note: "Simulated prices. Change is against the previous close (session) or the close 21 trading days ago (month).",
    symbols: SYMBOLS.map((s) => {
      const { base } = series(s, state.span);
      const last = feed.getQuote(s).last;
      return { symbol: s, sector: sectorOf(s), last, changePct: Number(((last / base - 1) * 100).toFixed(2)) };
    }),
  }),
});
