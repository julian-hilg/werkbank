import { defineTool, useLink, useToolState } from "@werkbank/framework";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { SymbolSearch } from "./SymbolSearch";
import { histogram, returns, stats } from "../market/analytics";
import { history, isSymbol, type SymbolId } from "../market/history";
import { diverging, downloadCsv, downloadSvg, useBox } from "./lib";

const stateSchema = z.object({ view: z.enum(["histogram", "calendar"]) });
type State = z.infer<typeof stateSchema>;
const p2 = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(2)}%`;

function Histogram({ symbol, svgRef }: { symbol: SymbolId; svgRef: React.RefObject<SVGSVGElement | null> }) {
  const [ref, box] = useBox<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const bins = useMemo(() => histogram(symbol), [symbol]);
  const s = useMemo(() => stats(symbol), [symbol]);
  const pad = { left: 30, right: 10, top: 8, bottom: 22 };
  const w = Math.max(0, box.width - pad.left - pad.right);
  const h = Math.max(0, box.height - pad.top - pad.bottom);
  const total = bins.reduce((n, b) => n + b.count, 0);
  const binWidth = bins[0]!.hi - bins[0]!.lo;
  // The normal curve with the same mean and spread, scaled to expected counts per bin.
  const normal = (x: number) => ((total * binWidth) / (s.sd * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - s.mean) / s.sd) ** 2);
  const top = Math.max(...bins.map((b) => b.count), normal(s.mean)) * 1.05;
  const [lo, hi] = [bins[0]!.lo, bins[bins.length - 1]!.hi];
  const x = (v: number) => pad.left + ((v - lo) / (hi - lo)) * w;
  const y = (c: number) => pad.top + (1 - c / top) * h;
  const slot = w / bins.length;
  return (
    <>
      <div className="st-readout wb-num">
        {hover !== null
          ? `${p2(bins[hover]!.lo)} to ${p2(bins[hover]!.hi)}   ${bins[hover]!.count} days   normal would give ${normal((bins[hover]!.lo + bins[hover]!.hi) / 2).toFixed(1)}`
          : "Bars: days with a return in each range. Line: a normal distribution with the same mean and spread."}
      </div>
      <div ref={ref} className="st-fill">
        {w > 0 && (
          <svg ref={svgRef} width={box.width} height={box.height} role="img" aria-label={`Distribution of daily returns of ${symbol}`} onPointerLeave={() => setHover(null)}>
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={pad.left + w} y1={y(top * t)} y2={y(top * t)} className="st-gridline" />
                <text x={pad.left - 5} y={y(top * t)} className="st-axis" textAnchor="end" dominantBaseline="middle">
                  {Math.round(top * t)}
                </text>
              </g>
            ))}
            {bins.map((b, i) => (
              <g key={i} onPointerEnter={() => setHover(i)}>
                <rect x={pad.left + i * slot} y={pad.top} width={slot} height={h} fill="transparent" />
                <rect
                  x={pad.left + i * slot + 1}
                  y={y(b.count)}
                  width={Math.max(1, slot - 2)}
                  height={Math.max(0, pad.top + h - y(b.count))}
                  style={{ fill: "var(--wb-accent)", opacity: hover === null || hover === i ? 1 : 0.55 }}
                />
              </g>
            ))}
            <polyline
              fill="none"
              style={{ stroke: "var(--wb-text)" }}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              points={Array.from({ length: 81 }, (_, k) => lo + ((hi - lo) * k) / 80).map((v) => `${x(v)},${y(normal(v))}`).join(" ")}
            />
            <line x1={x(0)} x2={x(0)} y1={pad.top} y2={pad.top + h} className="st-crosshair" />
            {[lo, lo / 2, 0, hi / 2, hi].map((v) => (
              <text key={v} x={x(v)} y={pad.top + h + 14} className="st-axis" textAnchor="middle">
                {p2(v)}
              </text>
            ))}
          </svg>
        )}
      </div>
    </>
  );
}

/** One square per trading day, coloured by that day's return: weeks run left to right. */
function Calendar({ symbol, svgRef }: { symbol: SymbolId; svgRef: React.RefObject<SVGSVGElement | null> }) {
  const [ref, box] = useBox<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const days = useMemo(() => {
    const bars = history(symbol);
    const r = returns(symbol);
    return r.map((value, i) => ({ date: bars[i + 1]!.date, value }));
  }, [symbol]);
  const extreme = Math.max(...days.map((d) => Math.abs(d.value)));
  // Monday-based week index of each day, counted from the first day shown.
  const first = new Date(`${days[0]!.date}T00:00:00`);
  const mondayOf = (d: Date) => Math.floor((d.getTime() - first.getTime()) / 86_400_000 + ((first.getDay() + 6) % 7)) ;
  const placed = days.map((d) => {
    const date = new Date(`${d.date}T00:00:00`);
    return { ...d, week: Math.floor(mondayOf(date) / 7), weekday: (date.getDay() + 6) % 7 };
  });
  const weeks = placed[placed.length - 1]!.week + 1;
  const pad = { left: 30, top: 18 };
  const size = Math.max(4, Math.min((box.width - pad.left - 6) / weeks, (box.height - pad.top - 6) / 5));
  return (
    <>
      <div className="st-readout wb-num">{hover !== null ? `${placed[hover]!.date}   ${p2(placed[hover]!.value)}` : "One square per trading day, coloured by the day's return."}</div>
      <div ref={ref} className="st-fill">
        {box.width > 0 && (
          <svg ref={svgRef} width={box.width} height={box.height} role="img" aria-label={`Calendar of daily returns of ${symbol}`} onPointerLeave={() => setHover(null)}>
            {["Mon", "Wed", "Fri"].map((name, k) => (
              <text key={name} x={pad.left - 5} y={pad.top + (k * 2 + 0.5) * size} className="st-axis" textAnchor="end" dominantBaseline="middle">
                {name}
              </text>
            ))}
            {placed.map((d, i) => (
              <g key={d.date}>
                {d.date.slice(8) <= "07" && d.weekday === 0 && (
                  <text x={pad.left + d.week * size} y={pad.top - 6} className="st-axis">
                    {new Date(`${d.date}T00:00:00`).toLocaleString("en-GB", { month: "short" })}
                  </text>
                )}
                <rect
                  x={pad.left + d.week * size + 1}
                  y={pad.top + d.weekday * size + 1}
                  width={Math.max(1, size - 2)}
                  height={Math.max(1, size - 2)}
                  style={{ fill: diverging(d.value / extreme), stroke: hover === i ? "var(--wb-text)" : "none" }}
                  onPointerEnter={() => setHover(i)}
                />
              </g>
            ))}
          </svg>
        )}
      </div>
    </>
  );
}

function Returns() {
  const [state, setState] = useToolState<State>();
  const [symbol, setSymbol] = useLink<SymbolId>("symbol");
  const svg = useRef<SVGSVGElement>(null);
  if (!symbol) return <p className="st-blank">No symbol. Link this panel to a group, or pick a symbol in a watchlist.</p>;
  const s = stats(symbol);
  const tile = (label: string, value: string) => (
    <div className="wb-kpi">
      <div className="wb-kpi-label">{label}</div>
      <div className="wb-kpi-value st-kpi-small">{value}</div>
    </div>
  );
  return (
    <div className="st-chart">
      <div className="wb-toolhead">
        <SymbolSearch symbol={symbol} onPick={setSymbol} />
        <span>daily returns, 250 days</span>
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="View">
          {(["histogram", "calendar"] as const).map((view) => (
            <button key={view} className="wb-button" aria-pressed={state.view === view} onClick={() => setState({ view })}>
              {view === "histogram" ? "Distribution" : "Calendar"}
            </button>
          ))}
        </span>
        <button className="wb-button" onClick={() => downloadCsv(`${symbol}-returns.csv`, ["date", "return"], returns(symbol).map((r, i) => [history(symbol)[i + 1]!.date, r.toFixed(6)]))}>
          CSV
        </button>
        <button className="wb-button" onClick={() => downloadSvg(`${symbol}-returns.svg`, svg.current)}>
          SVG
        </button>
      </div>
      <div className="wb-kpis">
        {tile("Ann. return", p2(s.annualReturn))}
        {tile("Ann. volatility", `${(s.annualVol * 100).toFixed(1)}%`)}
        {tile("Skew", s.skew.toFixed(2))}
        {tile("Excess kurtosis", s.kurtosis.toFixed(2))}
        {tile("Worst / best day", `${p2(s.worst)} / ${p2(s.best)}`)}
        {tile("Max drawdown", p2(s.maxDrawdown))}
      </div>
      {state.view === "histogram" ? <Histogram symbol={symbol} svgRef={svg} /> : <Calendar symbol={symbol} svgRef={svg} />}
    </div>
  );
}

export const returnsTool = defineTool<State>({
  id: "returns",
  title: "Return distribution",
  glyph: "▂",
  category: "Analytics",
  version: 1,
  stateSchema,
  defaultState: () => ({ view: "histogram" }),
  links: ["symbol"],
  component: Returns,
  describe: (state, { links }) => {
    if (!isSymbol(links.symbol)) return { symbol: null };
    const s = stats(links.symbol);
    return {
      symbol: links.symbol, view: state.view, note: "Statistics of daily returns over the synthetic history.",
      stats: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v.toFixed(5))])),
      histogram: histogram(links.symbol).map((b) => ({ from: Number(b.lo.toFixed(4)), to: Number(b.hi.toFixed(4)), days: b.count })),
    };
  },
});
