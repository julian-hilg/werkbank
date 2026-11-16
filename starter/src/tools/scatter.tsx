import { defineTool, useLink, useToolState } from "@werkbank/framework";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { stats } from "../market/analytics";
import { SYMBOLS, sectorOf, type SymbolId } from "../market/history";
import { useValuation } from "../portfolio/live";
import { niceDomain } from "./canvas";
import { downloadCsv, downloadSvg, useBox } from "./lib";

const stateSchema = z.object({ size: z.enum(["position", "equal"]) });
type State = z.infer<typeof stateSchema>;
const pc = (v: number) => `${(v * 100).toFixed(0)}%`;

const points = () => SYMBOLS.map((symbol) => ({ symbol, sector: sectorOf(symbol), ...stats(symbol) }));

function Scatter() {
  const [state, setState] = useToolState<State>();
  const [symbol, setSymbol] = useLink<SymbolId>("symbol");
  const [ref, box] = useBox<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<SymbolId | null>(null);
  const data = useMemo(points, []);
  const valuation = useValuation();
  const held = new Map(valuation.rows.map((r) => [r.symbol, r.value]));
  const biggest = Math.max(1, ...held.values());
  const pad = { left: 44, right: 44, top: 12, bottom: 32 };
  const w = Math.max(0, box.width - pad.left - pad.right);
  const h = Math.max(0, box.height - pad.top - pad.bottom);
  const xs = niceDomain(0, Math.max(...data.map((d) => d.annualVol)) * 1.08);
  const ys = niceDomain(Math.min(0, ...data.map((d) => d.annualReturn)) * 1.08, Math.max(0, ...data.map((d) => d.annualReturn)) * 1.08);
  const [x0, x1, y0, y1] = [xs[0]!, xs[xs.length - 1]!, ys[0]!, ys[ys.length - 1]!];
  const x = (v: number) => pad.left + ((v - x0) / (x1 - x0)) * w;
  const y = (v: number) => pad.top + (1 - (v - y0) / (y1 - y0)) * h;
  const radius = (s: SymbolId) => (state.size === "equal" ? 7 : 5 + 13 * Math.sqrt((held.get(s) ?? 0) / biggest));
  const shown = data.find((d) => d.symbol === hover);

  return (
    <div className="st-chart">
      <div className="wb-toolhead">
        <strong>Risk and return</strong>
        <span>annualised, 250 days</span>
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="Marker size">
          {(["position", "equal"] as const).map((size) => (
            <button key={size} className="wb-button" aria-pressed={state.size === size} onClick={() => setState({ size })}>
              {size === "position" ? "Size by position" : "Equal size"}
            </button>
          ))}
        </span>
        <button className="wb-button" onClick={() => downloadCsv("risk-return.csv", ["symbol", "sector", "annual_return", "annual_volatility"], data.map((d) => [d.symbol, d.sector, d.annualReturn.toFixed(4), d.annualVol.toFixed(4)]))}>
          CSV
        </button>
        <button className="wb-button" onClick={() => downloadSvg("risk-return.svg", svg.current)}>
          SVG
        </button>
      </div>
      <div className="st-readout wb-num">
        {shown
          ? `${shown.symbol} (${shown.sector})   return ${pc(shown.annualReturn)}   volatility ${pc(shown.annualVol)}   position ${Math.round(held.get(shown.symbol) ?? 0).toLocaleString("en-US")}`
          : "Each circle is a symbol; a hollow circle is not held. Click one to select it."}
      </div>
      <div ref={ref} className="st-fill">
        {w > 0 && (
          <svg ref={svg} width={box.width} height={box.height} role="img" aria-label="Annualised return against volatility for each symbol" onPointerLeave={() => setHover(null)}>
            {xs.map((v) => (
              <g key={`x${v}`}>
                <line x1={x(v)} x2={x(v)} y1={pad.top} y2={pad.top + h} className="st-gridline" />
                <text x={x(v)} y={pad.top + h + 14} className="st-axis" textAnchor="middle">
                  {pc(v)}
                </text>
              </g>
            ))}
            {ys.map((v) => (
              <g key={`y${v}`}>
                <line x1={pad.left} x2={pad.left + w} y1={y(v)} y2={y(v)} className={v === 0 ? "st-crosshair" : "st-gridline"} />
                <text x={pad.left - 6} y={y(v)} className="st-axis" textAnchor="end" dominantBaseline="middle">
                  {pc(v)}
                </text>
              </g>
            ))}
            <text x={pad.left + w / 2} y={pad.top + h + 28} className="st-axis" textAnchor="middle">
              volatility
            </text>
            <text x={12} y={pad.top + h / 2} className="st-axis" textAnchor="middle" transform={`rotate(-90 12 ${pad.top + h / 2})`}>
              return
            </text>
            {data.map((d) => {
              const r = radius(d.symbol);
              const isHeld = (held.get(d.symbol) ?? 0) > 0;
              return (
                <g key={d.symbol} style={{ cursor: "pointer" }} onPointerEnter={() => setHover(d.symbol)} onClick={() => setSymbol(d.symbol)}>
                  {/* A larger invisible target than the mark itself. */}
                  <circle cx={x(d.annualVol)} cy={y(d.annualReturn)} r={r + 8} fill="transparent" />
                  <circle
                    cx={x(d.annualVol)}
                    cy={y(d.annualReturn)}
                    r={r}
                    strokeWidth={2}
                    style={{
                      fill: isHeld ? "var(--wb-accent)" : "var(--wb-canvas)",
                      stroke: d.symbol === symbol ? "var(--wb-text)" : isHeld ? "var(--wb-canvas)" : "var(--wb-accent)",
                    }}
                  />
                  <text x={x(d.annualVol) + r + 4} y={y(d.annualReturn)} className={d.symbol === symbol ? "st-label st-strong" : "st-label"} dominantBaseline="middle">
                    {d.symbol}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

export const scatterTool = defineTool<State>({
  id: "scatter",
  title: "Risk / return",
  glyph: "⁙",
  category: "Analytics",
  version: 1,
  stateSchema,
  defaultState: () => ({ size: "position" }),
  links: ["symbol"],
  component: Scatter,
  describe: () => ({
    note: "Annualised return and volatility from the synthetic history.",
    points: points().map((d) => ({ symbol: d.symbol, sector: d.sector, annualReturn: Number(d.annualReturn.toFixed(4)), annualVol: Number(d.annualVol.toFixed(4)) })),
  }),
});
