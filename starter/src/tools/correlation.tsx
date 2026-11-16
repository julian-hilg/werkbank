import { Select, defineTool, useLink, useToolState } from "@werkbank/framework";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { clusteredOrder, correlationMatrix, rollingCorrelation, type CorrelationMethod } from "../market/analytics";
import { SYMBOLS, sectorOf, type SymbolId } from "../market/history";
import { diverging, downloadCsv, downloadSvg, inkOn, useBox } from "./lib";

const WINDOWS = [30, 60, 120, 249] as const;
const stateSchema = z.object({
  order: z.enum(["symbol", "sector", "clustered"]),
  values: z.boolean(),
  /** Lookback in trading days. */
  days: z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(249)]),
  method: z.enum(["pearson", "spearman"]),
  shape: z.enum(["full", "lower"]),
  /** Cells weaker than this (in absolute value) are faded, to bring out the strong links. */
  minAbs: z.number().min(0).max(0.9),
  /** The pair shown in the detail strip. */
  pair: z.tuple([z.enum(SYMBOLS), z.enum(SYMBOLS)]).nullable(),
  /**
   * Which symbols are compared. "sector" follows the panel's linked symbol:
   * its peers are the symbols of the same sector, so the matrix changes as
   * the selection does. "custom" is a fixed list, which the linked symbol
   * joins while it is selected.
   */
  peers: z.enum(["all", "sector", "custom"]),
  custom: z.array(z.enum(SYMBOLS)).max(SYMBOLS.length),
});
type State = z.infer<typeof stateSchema>;

const ROLLING = 30;

/** The symbols in the comparison, given the peer setting and what the panel is linked to. */
export function peerGroup(state: Pick<State, "peers" | "custom">, linked: SymbolId | undefined): SymbolId[] {
  if (state.peers === "sector" && linked) return SYMBOLS.filter((s) => sectorOf(s) === sectorOf(linked));
  if (state.peers === "custom") {
    const chosen = SYMBOLS.filter((s) => state.custom.includes(s) || s === linked);
    if (chosen.length >= 2) return chosen;
  }
  return [...SYMBOLS];
}
const orderOf = (state: State, matrix: number[][]): SymbolId[] =>
  state.order === "clustered"
    ? clusteredOrder(matrix)
    : state.order === "sector"
      ? [...SYMBOLS].sort((a, b) => sectorOf(a).localeCompare(sectorOf(b)) || a.localeCompare(b))
      : [...SYMBOLS];

/** How one pair's correlation moved over time. A reference line at zero; the value axis is always -1 to 1. */
function PairStrip({ pair, method }: { pair: [SymbolId, SymbolId]; method: CorrelationMethod }) {
  const [ref, box] = useBox<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => rollingCorrelation(pair[0], pair[1], ROLLING, method), [pair[0], pair[1], method]);
  const pad = { left: 30, right: 8, top: 6, bottom: 6 };
  const w = Math.max(0, box.width - pad.left - pad.right);
  const h = Math.max(0, box.height - pad.top - pad.bottom);
  const x = (i: number) => pad.left + (i / (data.length - 1)) * w;
  const y = (v: number) => pad.top + ((1 - v) / 2) * h;
  const at = hover !== null ? data[hover] : data[data.length - 1];
  return (
    <div className="st-pair">
      <div className="st-readout wb-num">
        {pair[0]} × {pair[1]}, {ROLLING}-day rolling: {at ? `${at.date}   ${at.value.toFixed(2)}` : ""}   range {Math.min(...data.map((d) => d.value)).toFixed(2)} to {Math.max(...data.map((d) => d.value)).toFixed(2)}
      </div>
      <div ref={ref} className="st-fill">
        {w > 0 && (
          <svg
            width={box.width}
            height={box.height}
            role="img"
            aria-label={`Rolling correlation of ${pair[0]} and ${pair[1]}`}
            onPointerMove={(e) => {
              const t = (e.clientX - e.currentTarget.getBoundingClientRect().left - pad.left) / (w || 1);
              setHover(Math.round(Math.min(1, Math.max(0, t)) * (data.length - 1)));
            }}
            onPointerLeave={() => setHover(null)}
          >
            {[1, 0, -1].map((v) => (
              <g key={v}>
                <line x1={pad.left} x2={pad.left + w} y1={y(v)} y2={y(v)} className={v === 0 ? "st-crosshair" : "st-gridline"} />
                <text x={pad.left - 5} y={y(v)} className="st-axis" textAnchor="end" dominantBaseline="middle">
                  {v > 0 ? "+1" : v}
                </text>
              </g>
            ))}
            <polyline fill="none" strokeWidth={2} strokeLinejoin="round" style={{ stroke: "var(--wb-accent)" }} points={data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ")} />
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + h} className="st-crosshair" />}
          </svg>
        )}
      </div>
    </div>
  );
}

function Correlation() {
  const [state, setState] = useToolState<State>();
  const [symbol, setSymbol] = useLink<SymbolId>("symbol");
  const [ref, box] = useBox<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<[SymbolId, SymbolId] | null>(null);
  const matrix = useMemo(() => correlationMatrix({ days: state.days, method: state.method }), [state.days, state.method]);
  const group = peerGroup(state, symbol);
  const names = useMemo(() => orderOf(state, matrix).filter((s) => group.includes(s)), [state.order, matrix, group.join()]);
  const pair = state.pair && group.includes(state.pair[0]) && group.includes(state.pair[1]) ? state.pair : null;
  const value = (a: SymbolId, b: SymbolId) => matrix[SYMBOLS.indexOf(a)]![SYMBOLS.indexOf(b)]!;
  const pad = { left: 46, top: 22, right: 8, bottom: 8 };
  const cell = Math.max(0, Math.min((box.width - pad.left - pad.right) / names.length, (box.height - pad.top - pad.bottom) / names.length));
  const offDiagonal = names.flatMap((a, i) => names.slice(0, i).map((b) => ({ a, b, v: value(a, b) })));
  const none = { a: names[0]!, b: names[0]!, v: 0 };
  const strongest = offDiagonal.reduce((m, p) => (p.v > m.v ? p : m), offDiagonal[0] ?? none);
  const weakest = offDiagonal.reduce((m, p) => (p.v < m.v ? p : m), offDiagonal[0] ?? none);
  const average = offDiagonal.reduce((s, p) => s + p.v, 0) / (offDiagonal.length || 1);
  const segment = <K extends keyof State>(key: K, options: readonly State[K][], label: (v: State[K]) => string, name: string) => (
    <span className="wb-segment" role="group" aria-label={name}>
      {options.map((option) => (
        <button key={String(option)} className="wb-button" aria-pressed={state[key] === option} onClick={() => setState({ ...state, [key]: option })}>
          {label(option)}
        </button>
      ))}
    </span>
  );

  return (
    <div className="st-chart">
      <div className="wb-toolhead">
        <strong>Return correlation</strong>
        <Select
          aria-label="Peer group"
          title="Which symbols are compared"
          value={state.peers}
          options={[
            { value: "all", label: "All symbols" },
            { value: "sector", label: symbol ? `Peers of ${symbol} (${sectorOf(symbol)})` : "Peers of the selected symbol" },
            { value: "custom", label: "Custom group" },
          ]}
          onChange={(peers) => setState({ ...state, peers, custom: state.custom.length ? state.custom : group })}
        />
        {segment("days", WINDOWS, (d) => (d === 249 ? "1Y" : `${d}d`), "Lookback")}
        {segment("method", ["pearson", "spearman"] as const, (m) => (m === "pearson" ? "Pearson" : "Spearman"), "Method")}
        {segment("order", ["symbol", "sector", "clustered"] as const, (o) => (o === "symbol" ? "A–Z" : o === "sector" ? "Sector" : "Clustered"), "Order")}
        {segment("shape", ["full", "lower"] as const, (s) => (s === "full" ? "Full" : "Triangle"), "Shape")}
        <label className="st-check" title="Fade cells whose correlation is weaker than this">
          fade below
          <input type="range" min={0} max={0.9} step={0.05} value={state.minAbs} aria-label="Fade correlations weaker than" onChange={(e) => setState({ ...state, minAbs: Number(e.target.value) })} />
          <span className="wb-num">{state.minAbs.toFixed(2)}</span>
        </label>
        <label className="st-check">
          <input type="checkbox" checked={state.values} onChange={(e) => setState({ ...state, values: e.target.checked })} />
          values
        </label>
        <span className="st-grow" />
        <button className="wb-button" onClick={() => downloadCsv(`correlation-${state.method}-${state.days}d.csv`, ["", ...names], names.map((a) => [a, ...names.map((b) => value(a, b).toFixed(4))]))}>
          CSV
        </button>
        <button className="wb-button" onClick={() => downloadSvg("correlation.svg", svg.current)}>
          SVG
        </button>
      </div>
      {state.peers === "custom" && (
        <div className="wb-toolhead" role="group" aria-label="Symbols in the custom group">
          <span>In the group:</span>
          <span className="st-chips">
            {SYMBOLS.map((s) => (
              <button
                key={s}
                className="wb-button"
                aria-pressed={group.includes(s)}
                // The linked symbol is always part of the comparison, so it cannot be switched off here.
                disabled={s === symbol && !state.custom.includes(s)}
                title={s === symbol && !state.custom.includes(s) ? "Included because it is the selected symbol" : sectorOf(s)}
                onClick={() => setState({ ...state, custom: state.custom.includes(s) ? state.custom.filter((x) => x !== s) : [...state.custom, s] })}
              >
                {s}
              </button>
            ))}
          </span>
          {group.length === SYMBOLS.length && state.custom.length < 2 && <span className="wb-warn">Pick at least two symbols.</span>}
        </div>
      )}
      <div className="st-readout wb-num">
        {hover
          ? `${hover[0]} (${sectorOf(hover[0])}) × ${hover[1]} (${sectorOf(hover[1])})   ${value(hover[0], hover[1]).toFixed(2)}`
          : `average ${average.toFixed(2)}   strongest ${strongest.a}–${strongest.b} ${strongest.v.toFixed(2)}   weakest ${weakest.a}–${weakest.b} ${weakest.v.toFixed(2)}   Click a cell for the pair's history.`}
      </div>
      <div ref={ref} className="st-fill">
        {cell > 0 && (
          <svg ref={svg} width={box.width} height={box.height} role="img" aria-label="Correlation matrix of daily returns" onPointerLeave={() => setHover(null)}>
            {names.map((name, i) => (
              <g key={name}>
                <text x={pad.left - 6} y={pad.top + (i + 0.5) * cell} className={name === symbol ? "st-label st-strong" : "st-axis"} textAnchor="end" dominantBaseline="middle">
                  {name}
                </text>
                <text x={pad.left + (i + 0.5) * cell} y={pad.top - 7} className={name === symbol ? "st-label st-strong" : "st-axis"} textAnchor="middle">
                  {name}
                </text>
              </g>
            ))}
            {names.map((a, i) =>
              names.map((b, j) => {
                if (state.shape === "lower" && j > i) return null;
                const v = value(a, b);
                const faded = a !== b && Math.abs(v) < state.minAbs;
                const chosen = pair && ((pair[0] === a && pair[1] === b) || (pair[0] === b && pair[1] === a));
                return (
                  <g
                    key={`${a}${b}`}
                    data-cell={`${a}-${b}`}
                    style={{ cursor: "pointer", opacity: faded ? 0.18 : 1 }}
                    onPointerEnter={() => setHover([a, b])}
                    onClick={() => {
                      setSymbol(a);
                      if (a !== b) setState({ ...state, pair: [a, b] });
                    }}
                  >
                    {/* A 2 px gap between cells keeps neighbours apart without borders. */}
                    <rect
                      x={pad.left + j * cell + 1}
                      y={pad.top + i * cell + 1}
                      width={Math.max(0, cell - 2)}
                      height={Math.max(0, cell - 2)}
                      strokeWidth={chosen ? 2 : 0}
                      style={{ fill: diverging(v), stroke: "var(--wb-text)" }}
                    />
                    {state.values && cell > 30 && (
                      <text x={pad.left + (j + 0.5) * cell} y={pad.top + (i + 0.5) * cell} textAnchor="middle" dominantBaseline="middle" className="st-cell" style={{ fill: inkOn(Math.abs(v)) }}>
                        {v.toFixed(2)}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
          </svg>
        )}
      </div>
      <div className="st-legend" aria-hidden>
        <span>−1</span>
        <span className="st-legend-bar" style={{ background: `linear-gradient(to right, ${diverging(-1)}, ${diverging(0)}, ${diverging(1)})` }} />
        <span>+1</span>
      </div>
      {pair && <PairStrip pair={pair} method={state.method} />}
    </div>
  );
}

export const correlationTool = defineTool<State>({
  id: "correlation",
  title: "Correlation",
  glyph: "▦",
  category: "Analytics",
  version: 3,
  stateSchema,
  defaultState: () => ({ order: "sector", values: true, days: 249, method: "pearson", shape: "full", minAbs: 0, pair: ["DLTA", "ECHO"], peers: "all", custom: [] }),
  // Version 1 had only the order and the values switch; version 2 had no peer groups.
  migrate: (state) => ({ days: 249, method: "pearson", shape: "full", minAbs: 0, pair: null, order: "sector", values: true, peers: "all", custom: [], ...(state as object) }),
  links: ["symbol"],
  component: Correlation,
  describe: (state, { links }) => {
    const m = correlationMatrix({ days: state.days, method: state.method });
    const linked = SYMBOLS.find((s) => s === links.symbol);
    const group = peerGroup(state, linked);
    const names = orderOf(state, m).filter((s) => group.includes(s));
    const rolling = state.pair ? rollingCorrelation(state.pair[0], state.pair[1], ROLLING, state.method) : null;
    return {
      note: "Correlation of daily returns over the synthetic history. Symbols share invented market and sector factors.",
      settings: { peers: state.peers, customGroup: state.custom, lookbackDays: state.days, method: state.method, order: state.order, shape: state.shape, fadeBelow: state.minAbs },
      options: { peers: ["all", "sector (peers of the linked symbol)", "custom"], lookbackDays: WINDOWS, method: ["pearson", "spearman"], order: ["symbol", "sector", "clustered"], shape: ["full", "lower"] },
      linkedSymbol: linked ?? null,
      symbols: names,
      sectors: Object.fromEntries(names.map((n) => [n, sectorOf(n)])),
      matrix: names.map((a) => names.map((b) => Number(m[SYMBOLS.indexOf(a)]![SYMBOLS.indexOf(b)]!.toFixed(3)))),
      pair: state.pair && rolling ? { symbols: state.pair, rollingWindowDays: ROLLING, latest: Number(rolling.at(-1)!.value.toFixed(3)), min: Number(Math.min(...rolling.map((r) => r.value)).toFixed(3)), max: Number(Math.max(...rolling.map((r) => r.value)).toFixed(3)) } : null,
    };
  },
});
