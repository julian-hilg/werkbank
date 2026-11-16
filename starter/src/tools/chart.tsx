import { copyText, defineTool, openContextMenu, useDoc, useInstanceId, useLink, useToolState, useWerkbank } from "@werkbank/framework";
import { useCallback, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { z } from "zod";
import { feed } from "../market/feed";
import { useFeedStatus, useQuote } from "../market/hooks";
import { isSymbol, summary, type Bar, type Range, type SymbolId } from "../market/history";
import { TIMEFRAMES, barLabel, series, type Timeframe } from "../market/intraday";
import { book } from "../portfolio/ledger";
import { useTrades } from "../portfolio/live";
import { niceTicks, useCanvas, type Surface } from "./canvas";
import { compact, pct, price, tone } from "./format";
import { downloadCanvas, downloadCsv } from "./lib";
import { SymbolSearch } from "./SymbolSearch";

const MIN_BARS = 15;
const MAX_BARS = 2000;

const stateSchema = z.object({
  scale: z.enum(["linear", "log"]),
  style: z.enum(["candles", "line"]),
  timeframe: z.enum(TIMEFRAMES),
  /** How many bars are in view. */
  count: z.number().int().min(MIN_BARS).max(MAX_BARS),
  /** Bars hidden to the right of the view. 0 means the view follows the live bar. */
  offset: z.number().int().min(0),
});
type State = z.infer<typeof stateSchema>;
type View = Pick<State, "count" | "offset">;

const PAD = { left: 8, right: 58, top: 10, bottom: 20 };
const VOLUME_SHARE = 0.2;
const GAP = 8;
const DEFAULT_COUNT: Record<Timeframe, number> = { "1m": 120, "5m": 156, "15m": 130, "1h": 35, "1D": 120 };

/** Keep a view inside the data: at least a few bars, never past either end. */
function clampView(view: View, total: number): View {
  const count = Math.min(Math.max(MIN_BARS, Math.round(view.count)), Math.max(MIN_BARS, Math.min(MAX_BARS, total)));
  return { count, offset: Math.min(Math.max(0, Math.round(view.offset)), Math.max(0, total - count)) };
}
const slice = (all: Bar[], view: View) => all.slice(Math.max(0, all.length - view.offset - view.count), all.length - view.offset);

interface Frame {
  bars: Bar[];
  range: Range | null;
  state: State;
  hover: number | null;
  drag: [number, number] | null;
  avgCost: number | null;
  stale: boolean;
}

function draw({ g, width, height, token }: Surface, f: Frame) {
  g.clearRect(0, 0, width, height);
  const { bars } = f;
  if (bars.length < 2) return;
  const plotW = width - PAD.left - PAD.right;
  const fullH = height - PAD.top - PAD.bottom;
  const volH = Math.round(fullH * VOLUME_SHARE);
  const priceH = fullH - volH - GAP;
  const volTop = PAD.top + priceH + GAP;
  const slot = plotW / bars.length;
  const x = (i: number) => PAD.left + (i + 0.5) * slot;
  const intraday = bars[0]!.time !== undefined;

  const scale = f.state.scale === "log" ? Math.log : (v: number) => v;
  const candles = f.state.style === "candles";
  const visibleLow = Math.min(...bars.map((b) => (candles ? b.low : b.close)));
  const visibleHigh = Math.max(...bars.map((b) => (candles ? b.high : b.close)));
  // The cost line only stretches the axis when it is close to the prices on screen.
  const costInView = f.avgCost !== null && f.avgCost > visibleLow * 0.9 && f.avgCost < visibleHigh * 1.1;
  const margin = (visibleHigh - visibleLow) * 0.04 || visibleHigh * 0.001;
  const lo = scale(Math.max(1e-6, Math.min(visibleLow, costInView ? f.avgCost! : Infinity) - margin));
  const hi = scale(Math.max(visibleHigh, costInView ? f.avgCost! : -Infinity) + margin);
  const y = (v: number) => PAD.top + (1 - (scale(v) - lo) / (hi - lo || 1)) * priceH;

  // Price grid and labels. Volume has its own pane and its own scale below.
  g.textBaseline = "middle";
  g.lineWidth = 1;
  const unscale = f.state.scale === "log" ? Math.exp : (v: number) => v;
  for (const value of niceTicks(unscale(lo), unscale(hi))) {
    const yy = Math.round(y(value)) + 0.5;
    g.strokeStyle = token("--wb-grid");
    g.beginPath();
    g.moveTo(PAD.left, yy);
    g.lineTo(PAD.left + plotW, yy);
    g.stroke();
    g.fillStyle = token("--wb-text-dim");
    g.fillText(price(value), PAD.left + plotW + 6, yy);
  }
  const maxVolume = Math.max(...bars.map((b) => b.volume), 1);
  g.fillStyle = token("--wb-text-dim");
  g.fillText(compact(maxVolume), PAD.left + plotW + 6, volTop + 5);

  // Time axis. On intraday charts a faint line marks each new day.
  g.textBaseline = "alphabetic";
  const clock = (b: Bar) => new Date(b.time!).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const tickText = (i: number) => (intraday ? (i === 0 || bars[i]!.date !== bars[i - 1]!.date ? bars[i]!.date.slice(5) : clock(bars[i]!)) : bars[i]!.date);
  const wanted = Math.max(2, Math.floor(plotW / 110));
  let lastRight = -Infinity;
  for (let k = 0; k <= wanted; k++) {
    const i = Math.min(bars.length - 1, Math.round((k / wanted) * (bars.length - 1)));
    const text = tickText(i);
    const w = g.measureText(text).width;
    const left = Math.min(Math.max(x(i) - w / 2, PAD.left), PAD.left + plotW - w);
    if (left < lastRight + 8) continue;
    g.fillStyle = token("--wb-text-dim");
    g.fillText(text, left, height - 6);
    lastRight = left + w;
  }
  if (intraday) {
    g.strokeStyle = token("--wb-border");
    g.setLineDash([2, 3]);
    bars.forEach((bar, i) => {
      if (i === 0 || bar.date === bars[i - 1]!.date) return;
      const xx = Math.round(x(i) - slot / 2) + 0.5;
      g.beginPath();
      g.moveTo(xx, PAD.top);
      g.lineTo(xx, PAD.top + fullH);
      g.stroke();
    });
    g.setLineDash([]);
  }

  const band = (from: number, to: number, alpha: number) => {
    g.globalAlpha = alpha;
    g.fillStyle = token("--wb-accent");
    g.fillRect(Math.min(from, to), PAD.top, Math.abs(to - from), fullH);
    g.globalAlpha = 1;
  };
  if (f.range) {
    const a = bars.findIndex((b) => b.date >= f.range!.from);
    let b = -1;
    bars.forEach((bar, i) => bar.date <= f.range!.to && (b = i));
    if (a >= 0 && b >= a) band(x(a) - slot / 2, x(b) + slot / 2, 0.12);
  }
  if (f.drag) band(f.drag[0], f.drag[1], 0.22);

  const up = token("--wb-good");
  const down = token("--wb-bad");
  const bodyW = Math.max(1, Math.min(11, Math.floor(slot * 0.7)));
  const alpha = f.stale ? 0.5 : 1;

  bars.forEach((bar, i) => {
    const colour = bar.close >= bar.open ? up : down;
    // Volume bars rise from the pane's baseline, with a gap between neighbours.
    const vh = Math.max(1, (bar.volume / maxVolume) * volH);
    g.globalAlpha = alpha * 0.55;
    g.fillStyle = colour;
    g.fillRect(Math.round(x(i) - bodyW / 2), volTop + volH - vh, bodyW, vh);
    g.globalAlpha = alpha;
    if (!candles) return;
    g.strokeStyle = colour;
    g.beginPath();
    g.moveTo(Math.round(x(i)) + 0.5, y(bar.high));
    g.lineTo(Math.round(x(i)) + 0.5, y(bar.low));
    g.stroke();
    const top = y(Math.max(bar.open, bar.close));
    g.fillRect(Math.round(x(i) - bodyW / 2), top, bodyW, Math.max(1, y(Math.min(bar.open, bar.close)) - top));
  });

  if (!candles) {
    g.strokeStyle = token("--wb-accent");
    g.lineWidth = 2;
    g.lineJoin = "round";
    g.beginPath();
    bars.forEach((bar, i) => (i ? g.lineTo(x(i), y(bar.close)) : g.moveTo(x(i), y(bar.close))));
    g.stroke();
    g.lineWidth = 1;
  }
  g.globalAlpha = 1;

  // Reference lines carry a text label, so they do not rely on colour.
  const reference = (value: number, text: string, dash: number[]) => {
    const yy = Math.round(y(value)) + 0.5;
    if (yy < PAD.top || yy > PAD.top + priceH) return;
    g.setLineDash(dash);
    g.strokeStyle = token("--wb-text-dim");
    g.beginPath();
    g.moveTo(PAD.left, yy);
    g.lineTo(PAD.left + plotW, yy);
    g.stroke();
    g.setLineDash([]);
    const w = g.measureText(text).width + 8;
    g.fillStyle = token("--wb-canvas");
    g.fillRect(PAD.left + 2, yy - 13, w, 12);
    g.fillStyle = token("--wb-text-dim");
    g.fillText(text, PAD.left + 6, yy - 3);
  };
  if (f.avgCost !== null) reference(f.avgCost, `avg cost ${price(f.avgCost)}`, [5, 3]);
  if (f.state.offset === 0) reference(bars[bars.length - 1]!.close, `last ${price(bars[bars.length - 1]!.close)}`, [1, 3]);

  if (f.hover !== null && f.hover < bars.length) {
    const hx = Math.round(x(f.hover)) + 0.5;
    g.strokeStyle = token("--wb-text-dim");
    g.beginPath();
    g.moveTo(hx, PAD.top);
    g.lineTo(hx, PAD.top + fullH);
    g.stroke();
  }
}

function Chart() {
  const [state, setState] = useToolState<State>();
  const wb = useWerkbank();
  const instanceId = useInstanceId();
  const [symbol, setSymbol] = useLink<SymbolId>("symbol");
  const [range, setRange] = useLink<Range | null>("range");
  const theme = useDoc((doc) => doc.shell.theme);
  const quote = useQuote(symbol);
  const status = useFeedStatus();
  const trades = useTrades();
  const [hover, setHover] = useState<number | null>(null);
  const [brush, setBrush] = useState<[number, number] | null>(null);
  // While panning, the view lives here; it is written to the panel's state when the drag ends.
  const [panning, setPanning] = useState<View | null>(null);
  const pan = useRef<{ x: number; offset: number } | null>(null);

  // `quote` is a dependency so the last bar follows the stream.
  const all = useMemo(() => (symbol ? series(symbol, state.timeframe) : []), [symbol, state.timeframe, quote]);
  const view = clampView(panning ?? state, all.length);
  const bars = useMemo(() => slice(all, view), [all, view.count, view.offset]);
  const position = symbol ? book(trades).positions.get(symbol) : undefined;
  const avgCost = position && position.qty > 0 ? position.avgCost : null;
  const stale = status !== "live";

  const paint = useCallback(
    (surface: Surface) => draw(surface, { bars, range: range ?? null, state: { ...state, ...view }, hover, drag: brush, avgCost, stale }),
    [bars, range, state, view.count, view.offset, hover, brush, avgCost, stale, theme],
  );
  const canvas = useCanvas(paint);

  const geometry = () => {
    const rect = canvas.current!.getBoundingClientRect();
    return { left: rect.left, plotW: rect.width - PAD.left - PAD.right };
  };
  const indexAt = (clientX: number) => {
    const { left, plotW } = geometry();
    return Math.min(bars.length - 1, Math.max(0, Math.floor(((clientX - left - PAD.left) / plotW) * bars.length)));
  };
  const localX = (e: PointerEvent) => e.clientX - geometry().left;
  const commit = (next: View) => setState({ ...state, ...clampView(next, all.length) });

  /** Zoom by a factor, keeping the bar at fraction `anchor` of the plot (0 left, 1 right) where it is. */
  const zoom = (factor: number, anchor = 1) => {
    const count = clampView({ count: view.count * factor, offset: 0 }, all.length).count;
    commit({ count, offset: view.offset + (view.count - count) * (1 - anchor) });
  };
  const onWheel = (e: WheelEvent) => {
    const { left, plotW } = geometry();
    const anchor = Math.min(1, Math.max(0, (e.clientX - left - PAD.left) / plotW));
    // A horizontal scroll (trackpad swipe) pans; a vertical one zooms.
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) commit({ count: view.count, offset: view.offset - Math.round((e.deltaX / plotW) * view.count) });
    else zoom(e.deltaY > 0 ? 1.18 : 1 / 1.18, anchor);
  };

  if (!symbol) {
    return (
      <div className="wb-toolhead">
        <SymbolSearch symbol={undefined} onPick={setSymbol} />
        <span>Search for a symbol, or link this panel to a group.</span>
      </div>
    );
  }
  const shown = hover !== null ? bars[hover] : bars[bars.length - 1];
  const stats = summary(bars);
  const dayChange = quote ? quote.last / quote.prevClose - 1 : 0;
  const exportCsv = () =>
    downloadCsv(`${symbol}-${state.timeframe}.csv`, ["time", "open", "high", "low", "close", "volume"], bars.map((b) => [barLabel(b), b.open, b.high, b.low, b.close, b.volume]));

  return (
    <div className="st-chart">
      <div className="wb-toolhead">
        <SymbolSearch symbol={symbol} onPick={setSymbol} />
        {quote && (
          <>
            <span className={`wb-num ${stale ? "wb-stale" : ""}`}>{price(quote.last)}</span>
            <span className={`wb-num ${tone(dayChange) ?? ""}`}>{pct(dayChange)} today</span>
          </>
        )}
        {stale && <span className="wb-badge" data-tone="warn">stale: feed {status}</span>}
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((timeframe) => (
            <button
              key={timeframe}
              className="wb-button"
              aria-pressed={state.timeframe === timeframe}
              onClick={() => setState({ ...state, timeframe, count: DEFAULT_COUNT[timeframe], offset: 0 })}
            >
              {timeframe}
            </button>
          ))}
        </span>
        <span className="wb-segment" role="group" aria-label="Zoom">
          <button className="wb-button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1.5)}>
            −
          </button>
          <button className="wb-button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1 / 1.5)}>
            +
          </button>
          <button className="wb-button" title="Show every bar" onClick={() => commit({ count: all.length, offset: 0 })}>
            All
          </button>
        </span>
        {view.offset > 0 && (
          <button className="wb-button" title="Jump to the latest bar and follow it" onClick={() => commit({ count: view.count, offset: 0 })}>
            Live ▸
          </button>
        )}
        {range && (
          <button className="wb-button" onClick={() => setRange(null)}>
            Clear range
          </button>
        )}
        <button className="wb-button" onClick={() => setState({ ...state, style: state.style === "candles" ? "line" : "candles" })}>
          {state.style}
        </button>
        <button className="wb-button" onClick={() => setState({ ...state, scale: state.scale === "linear" ? "log" : "linear" })}>
          {state.scale}
        </button>
        <button className="wb-button" onClick={exportCsv}>
          CSV
        </button>
        <button className="wb-button" onClick={() => downloadCanvas(`${symbol}-${state.timeframe}.png`, canvas.current)}>
          PNG
        </button>
      </div>
      <div className="st-readout wb-num">
        {shown
          ? `${barLabel(shown)}   O ${price(shown.open)}   H ${price(shown.high)}   L ${price(shown.low)}   C ${price(shown.close)}   V ${compact(shown.volume)}` +
            (hover === null && stats ? `      ${bars.length} bars, ${pct(stats.changePct / 100)} in view` : "")
          : " "}
      </div>
      <canvas
        ref={canvas}
        className="st-canvas st-grab"
        role="img"
        aria-label={`Price and volume of ${symbol}, ${state.timeframe} bars. Scroll to zoom, drag to pan, shift-drag to select a date range.`}
        onWheel={onWheel}
        onDoubleClick={() => commit({ count: DEFAULT_COUNT[state.timeframe], offset: 0 })}
        onContextMenu={(e) =>
          openContextMenu(wb, e, [
            { heading: "Timeframe" },
            ...TIMEFRAMES.map((timeframe) => ({ label: timeframe, checked: state.timeframe === timeframe, run: () => setState({ ...state, timeframe, count: DEFAULT_COUNT[timeframe], offset: 0 }) })),
            { separator: true },
            { label: "Candles", checked: state.style === "candles", run: () => setState({ ...state, style: "candles" }) },
            { label: "Line", checked: state.style === "line", run: () => setState({ ...state, style: "line" }) },
            { label: "Logarithmic scale", checked: state.scale === "log", run: () => setState({ ...state, scale: state.scale === "log" ? "linear" : "log" }) },
            { separator: true },
            { label: "Reset zoom", run: () => commit({ count: DEFAULT_COUNT[state.timeframe], offset: 0 }) },
            { label: "Show every bar", run: () => commit({ count: all.length, offset: 0 }) },
            { separator: true },
            ...(shown ? [{ label: `Copy this bar (${barLabel(shown)})`, run: () => copyText(`${barLabel(shown)}\tO ${shown.open}\tH ${shown.high}\tL ${shown.low}\tC ${shown.close}\tV ${shown.volume}`) }] : []),
            { label: "Export the bars in view as CSV", run: exportCsv },
            { label: "Export as PNG", run: () => downloadCanvas(`${symbol}-${state.timeframe}.png`, canvas.current) },
            { separator: true },
            { label: "Open an order ticket on this symbol", run: () => void wb.run("panel.open", { toolId: "ticket", link: wb.requireInstance(instanceId).link }) },
          ])
        }
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          if (e.shiftKey) setBrush([localX(e), localX(e)]);
          else pan.current = { x: e.clientX, offset: view.offset };
        }}
        onPointerMove={(e) => {
          setHover(indexAt(e.clientX));
          if (brush) setBrush([brush[0], localX(e)]);
          else if (pan.current) {
            const slot = geometry().plotW / view.count;
            setPanning(clampView({ count: view.count, offset: pan.current.offset + Math.round((e.clientX - pan.current.x) / slot) }, all.length));
          }
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={(e) => {
          if (brush) {
            const { left } = geometry();
            const a = indexAt(left + Math.min(brush[0], localX(e)));
            const b = indexAt(left + Math.max(brush[0], localX(e)));
            setBrush(null);
            if (b > a) setRange({ from: bars[a]!.date, to: bars[b]!.date });
          }
          if (pan.current && panning) commit(panning);
          pan.current = null;
          setPanning(null);
        }}
        onPointerCancel={() => {
          setBrush(null);
          pan.current = null;
          setPanning(null);
        }}
      />
      <div className="st-hint">Scroll to zoom · drag to pan · shift-drag to select a date range · double-click to reset</div>
    </div>
  );
}

export const chart = defineTool<State>({
  id: "chart",
  title: "Chart",
  glyph: "∿",
  category: "Trading",
  version: 3,
  stateSchema,
  defaultState: () => ({ scale: "linear", style: "candles", timeframe: "1D", count: 120, offset: 0 }),
  // Version 1 stored only the scale; version 2 had a fixed window instead of a zoomable view.
  migrate: (state) => {
    const old = (state ?? {}) as { scale?: string; style?: string; window?: number };
    return { scale: old.scale ?? "linear", style: old.style ?? "candles", timeframe: "1D", count: Math.min(MAX_BARS, old.window ?? 120), offset: 0 };
  },
  links: ["symbol", "range"],
  component: Chart,
  describe: (state, { links }) => {
    const symbol = isSymbol(links.symbol) ? links.symbol : null;
    const range = (links.range as Range | null | undefined) ?? null;
    if (!symbol) return { symbol: null };
    const all = series(symbol, state.timeframe);
    const bars = slice(all, clampView(state, all.length));
    const quote = feed.getQuote(symbol);
    return {
      symbol,
      timeframe: state.timeframe,
      availableTimeframes: TIMEFRAMES,
      style: state.style,
      scale: state.scale,
      view: { barsShown: bars.length, barsAvailable: all.length, from: bars[0] ? barLabel(bars[0]) : null, to: bars.at(-1) ? barLabel(bars.at(-1)!) : null, followsLive: state.offset === 0 },
      selectedRange: range,
      note: "Simulated data. Zoom with panel.setState { count }, pan with { offset } (bars hidden on the right), change bars with { timeframe }.",
      feed: feed.getStatus(),
      quote: { last: quote.last, bid: quote.bid, ask: quote.ask, prevClose: quote.prevClose, live: feed.isLive() },
      shown: summary(bars),
      lastBars: bars.slice(-5).map((b) => ({ time: barLabel(b), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
    };
  },
});
