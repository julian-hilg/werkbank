import { defineTool, useLink, useToolState } from "@werkbank/framework";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { correlationMatrix, type CorrelationMethod } from "../market/analytics";
import { SECTORS, SYMBOLS, sectorOf, type SymbolId } from "../market/history";
import { downloadCsv, downloadSvg, useBox } from "./lib";

const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const stateSchema = z.object({
  /** Two symbols are joined when the absolute value of their correlation is at least this. */
  threshold: z.number().min(0.1).max(0.8),
  method: z.enum(["pearson", "spearman"]),
  /** Where the person dragged a node to, by symbol, in 0..1 of the drawing area. */
  overrides: z.record(z.string(), point),
});
type State = z.infer<typeof stateSchema>;
type Point = z.infer<typeof point>;

// ---- the graph ------------------------------------------------------------------

export interface NetworkEdge {
  a: SymbolId;
  b: SymbolId;
  value: number;
}
export interface Network {
  nodes: { symbol: SymbolId; sector: string; degree: number }[];
  edges: NetworkEdge[];
  isolated: SymbolId[];
}

/** Symbols as nodes, and an edge for every pair whose |correlation| reaches the threshold. `matrix` is indexed like `symbols`. */
export function buildNetwork(matrix: number[][], threshold: number, symbols: readonly SymbolId[] = SYMBOLS): Network {
  const edges: NetworkEdge[] = [];
  symbols.forEach((a, i) =>
    symbols.slice(i + 1).forEach((b, k) => {
      const value = matrix[i]?.[i + 1 + k] ?? 0;
      if (Math.abs(value) >= threshold) edges.push({ a, b, value });
    }),
  );
  const nodes = symbols.map((symbol) => ({ symbol, sector: sectorOf(symbol), degree: edges.filter((e) => e.a === symbol || e.b === symbol).length }));
  return { nodes, edges, isolated: nodes.filter((n) => n.degree === 0).map((n) => n.symbol) };
}

// ---- the layout -----------------------------------------------------------------

export interface LayoutEdge {
  /** Indices of the two nodes. */
  a: number;
  b: number;
  /** Strength in 0..1; a stronger edge has a shorter rest length. */
  weight: number;
}

/**
 * A small force-directed layout. Deterministic: the nodes start evenly on a
 * circle and a fixed number of steps is run, so the same graph always gives
 * the same picture. Every pair repels, edges pull like springs, and a weak
 * pull to the centre keeps unconnected nodes in view. Positions come back in 0..1.
 */
export function forceLayout(count: number, edges: LayoutEdge[], options: { iterations?: number; seed?: number } = {}): Point[] {
  const { iterations = 300, seed = 0.35 } = options;
  if (count <= 0) return [];
  const xs = Array.from({ length: count }, (_, i) => Math.cos(seed + (2 * Math.PI * i) / count));
  const ys = Array.from({ length: count }, (_, i) => Math.sin(seed + (2 * Math.PI * i) / count));
  const REPEL = 0.08;
  const CENTRE = 0.03;
  for (let step = 0; step < iterations; step++) {
    const fx = new Array<number>(count).fill(0);
    const fy = new Array<number>(count).fill(0);
    for (let i = 0; i < count; i++) {
      fx[i]! -= CENTRE * xs[i]!;
      fy[i]! -= CENTRE * ys[i]!;
      for (let j = i + 1; j < count; j++) {
        const dx = xs[i]! - xs[j]!;
        const dy = ys[i]! - ys[j]!;
        const d = Math.max(0.02, Math.hypot(dx, dy));
        const f = REPEL / (d * d);
        fx[i]! += (dx / d) * f;
        fy[i]! += (dy / d) * f;
        fx[j]! -= (dx / d) * f;
        fy[j]! -= (dy / d) * f;
      }
    }
    for (const edge of edges) {
      if (edge.a === edge.b || edge.a < 0 || edge.b < 0 || edge.a >= count || edge.b >= count) continue;
      const weight = Math.min(1, Math.max(0, edge.weight));
      const dx = xs[edge.b]! - xs[edge.a]!;
      const dy = ys[edge.b]! - ys[edge.a]!;
      const d = Math.max(0.02, Math.hypot(dx, dy));
      const rest = 0.9 - 0.65 * weight;
      const f = 0.12 * (0.5 + weight) * (d - rest);
      fx[edge.a]! += (dx / d) * f;
      fy[edge.a]! += (dy / d) * f;
      fx[edge.b]! -= (dx / d) * f;
      fy[edge.b]! -= (dy / d) * f;
    }
    // The longest allowed move shrinks with every step, so the layout settles.
    const limit = 0.2 * (1 - step / iterations) + 0.004;
    for (let i = 0; i < count; i++) {
      const size = Math.hypot(fx[i]!, fy[i]!);
      const k = size > limit ? limit / size : 1;
      xs[i]! += fx[i]! * k;
      ys[i]! += fy[i]! * k;
    }
  }
  // One scale for both directions, so distances keep their proportions.
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const unit = (v: number) => Math.min(1, Math.max(0, v));
  return xs.map((x, i) => ({ x: unit(0.5 + (x - (x0 + x1) / 2) / span), y: unit(0.5 + (ys[i]! - (y0 + y1) / 2) / span) }));
}

const layoutOf = (network: Network): Point[] =>
  forceLayout(
    network.nodes.length,
    network.edges.map((e) => ({ a: SYMBOLS.indexOf(e.a), b: SYMBOLS.indexOf(e.b), weight: Math.abs(e.value) })),
  );

// ---- the view -------------------------------------------------------------------

const SHAPES = ["circle", "square", "diamond"] as const;
type Shape = (typeof SHAPES)[number];
const shapeOf = (sector: string): Shape => SHAPES[Math.max(0, (SECTORS as readonly string[]).indexOf(sector)) % SHAPES.length]!;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
const methodName = (m: CorrelationMethod) => (m === "pearson" ? "Pearson" : "Spearman");

/** The mark for a sector. The three shapes cover about the same area at one `r`. */
function Mark({ shape, x, y, r, ...rest }: { shape: Shape; x: number; y: number; r: number } & React.SVGProps<SVGElement>) {
  const props = rest as Record<string, unknown>;
  if (shape === "circle") return <circle cx={x} cy={y} r={r} {...props} />;
  if (shape === "square") return <rect x={x - r * 0.89} y={y - r * 0.89} width={r * 1.78} height={r * 1.78} {...props} />;
  const d = r * 1.25;
  return <polygon points={`${x},${y - d} ${x + d},${y} ${x},${y + d} ${x - d},${y}`} {...props} />;
}

type Hover = { node: SymbolId } | { edge: [SymbolId, SymbolId] } | null;
const PAD = { left: 30, right: 58, top: 26, bottom: 26 };

function NetworkView() {
  const [state, setState] = useToolState<State>();
  const [symbol, setSymbol] = useLink<SymbolId>("symbol");
  const [ref, box] = useBox<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover>(null);
  /** The node being dragged and where it is now. Written to the panel state when the drag ends. */
  const [drag, setDrag] = useState<({ id: SymbolId } & Point) | null>(null);
  const press = useRef<{ id: SymbolId; x: number; y: number; moved: boolean } | null>(null);

  const matrix = useMemo(() => correlationMatrix({ method: state.method }), [state.method]);
  const network = useMemo(() => buildNetwork(matrix, state.threshold), [matrix, state.threshold]);
  const base = useMemo(() => layoutOf(network), [network]);
  const value = (a: SymbolId, b: SymbolId) => matrix[SYMBOLS.indexOf(a)]?.[SYMBOLS.indexOf(b)] ?? 0;

  const w = Math.max(0, box.width - PAD.left - PAD.right);
  const h = Math.max(0, box.height - PAD.top - PAD.bottom);
  const where = (s: SymbolId): Point => (drag?.id === s ? drag : (state.overrides[s] ?? base[SYMBOLS.indexOf(s)] ?? { x: 0.5, y: 0.5 }));
  const px = (s: SymbolId) => PAD.left + where(s).x * w;
  const py = (s: SymbolId) => PAD.top + where(s).y * h;
  const radius = (degree: number) => 7 + 2.2 * degree;
  const moved = Object.keys(state.overrides).length;

  /** A pointer position as 0..1 of the drawing area. */
  const toUnit = (e: React.PointerEvent<SVGSVGElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    const unit = (v: number) => Math.min(1, Math.max(0, v));
    return { x: unit((e.clientX - rect.left - PAD.left) / (w || 1)), y: unit((e.clientY - rect.top - PAD.top) / (h || 1)) };
  };
  const endPress = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    press.current = null;
    setDrag(null);
  };

  const readout = () => {
    if (hover && "node" in hover) {
      const node = network.nodes.find((n) => n.symbol === hover.node);
      const strongest = SYMBOLS.filter((s) => s !== hover.node)
        .map((s) => ({ s, v: value(hover.node, s) }))
        .sort((p, q) => Math.abs(q.v) - Math.abs(p.v))
        .slice(0, 3);
      return `${hover.node} (${sectorOf(hover.node)})   ${node?.degree ?? 0} ${node?.degree === 1 ? "link" : "links"} shown   strongest: ${strongest.map((p) => `${p.s} ${signed(p.v)}`).join(", ")}`;
    }
    if (hover && "edge" in hover) {
      const [a, b] = hover.edge;
      return `${a} (${sectorOf(a)}) – ${b} (${sectorOf(b)})   ${methodName(state.method)} correlation ${signed(value(a, b))}`;
    }
    return `${network.edges.length} of ${(SYMBOLS.length * (SYMBOLS.length - 1)) / 2} pairs at |ρ| ≥ ${state.threshold.toFixed(2)}${network.isolated.length ? `   unconnected: ${network.isolated.join(", ")}` : ""}   Drag a symbol to move it, click to select it.`;
  };

  return (
    <div className="st-chart">
      <div className="wb-toolhead">
        <strong>Correlation network</strong>
        <span className="wb-badge">sample data</span>
        <span className="wb-segment" role="group" aria-label="Method">
          {(["pearson", "spearman"] as const).map((method) => (
            <button key={method} className="wb-button" aria-pressed={state.method === method} onClick={() => setState({ ...state, method })}>
              {methodName(method)}
            </button>
          ))}
        </span>
        <label className="st-check" title="Join two symbols when the absolute value of their correlation is at least this">
          link at |ρ| ≥
          <input type="range" min={0.1} max={0.8} step={0.05} value={state.threshold} aria-label="Smallest correlation that makes a link" onChange={(e) => setState({ ...state, threshold: Math.min(0.8, Math.max(0.1, Number(e.target.value))) })} />
          <span className="wb-num">{state.threshold.toFixed(2)}</span>
        </label>
        <span className="st-grow" />
        <button className="wb-button" disabled={!moved} title="Forget the dragged positions and lay the graph out again" onClick={() => setState({ ...state, overrides: {} })}>
          Re-layout
        </button>
        <button className="wb-button" onClick={() => downloadCsv(`correlation-network-${state.method}.csv`, ["a", "b", "correlation"], network.edges.map((e) => [e.a, e.b, e.value.toFixed(4)]))}>
          CSV
        </button>
        <button className="wb-button" onClick={() => downloadSvg("correlation-network.svg", svg.current)}>
          SVG
        </button>
      </div>
      <div className="st-readout wb-num">{readout()}</div>
      <div ref={ref} className="st-fill">
        {w > 0 && h > 0 && (
          <svg
            ref={svg}
            className="sx-network"
            width={box.width}
            height={box.height}
            role="img"
            aria-label={`Network of ${SYMBOLS.length} symbols with ${network.edges.length} links where the ${methodName(state.method)} correlation is at least ${state.threshold.toFixed(2)} in absolute value`}
            onPointerDown={(e) => {
              const id = (e.target as Element).closest?.("[data-node]")?.getAttribute("data-node") as SymbolId | null | undefined;
              if (!id || e.button !== 0) return;
              // Capturing the pointer keeps the drag alive outside the node, and also swallows
              // click events on it: click or drag is decided in onPointerUp.
              e.currentTarget.setPointerCapture(e.pointerId);
              press.current = { id, x: e.clientX, y: e.clientY, moved: false };
            }}
            onPointerMove={(e) => {
              const p = press.current;
              if (p) {
                if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) p.moved = true;
                if (p.moved) setDrag({ id: p.id, ...toUnit(e) });
                return;
              }
              const el = (e.target as Element).closest?.("[data-node],[data-edge]");
              const node = el?.getAttribute("data-node") as SymbolId | null | undefined;
              const edge = el?.getAttribute("data-edge")?.split("-") as [SymbolId, SymbolId] | undefined;
              setHover((was) => {
                if (node) return was && "node" in was && was.node === node ? was : { node };
                if (edge) return was && "edge" in was && was.edge[0] === edge[0] && was.edge[1] === edge[1] ? was : { edge };
                return null;
              });
            }}
            onPointerUp={(e) => {
              const p = press.current;
              if (!p) return;
              if (p.moved) {
                setState({ ...state, overrides: { ...state.overrides, [p.id]: toUnit(e) } });
              } else {
                // No movement: a click. The captured pointer reports the svg as its target, so look up what is under it.
                const hit = e.currentTarget.ownerDocument.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node]")?.getAttribute("data-node");
                if (hit === p.id) setSymbol(p.id);
              }
              endPress(e);
            }}
            onPointerCancel={endPress}
            onPointerLeave={() => !press.current && setHover(null)}
          >
            {network.edges.map((e) => {
              const [x1, y1, x2, y2] = [px(e.a), py(e.a), px(e.b), py(e.b)];
              const on = hover && "edge" in hover && hover.edge[0] === e.a && hover.edge[1] === e.b;
              return (
                <g key={`${e.a}-${e.b}`} data-edge={`${e.a}-${e.b}`}>
                  {/* Sign is drawn twice: colour, and solid against dashed. */}
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    strokeWidth={1 + 5 * Math.abs(e.value)}
                    strokeLinecap="round"
                    strokeDasharray={e.value < 0 ? "7 5" : undefined}
                    style={{ stroke: e.value >= 0 ? "var(--wb-good)" : "var(--wb-bad)", opacity: on ? 1 : 0.7 }}
                  />
                  {/* A wider invisible target than the line itself. */}
                  <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={14} stroke="transparent" />
                </g>
              );
            })}
            {network.nodes.map((n) => {
              const r = radius(n.degree);
              const linked = n.symbol === symbol;
              const [x, y] = [px(n.symbol), py(n.symbol)];
              return (
                <g
                  key={n.symbol}
                  className="sx-net-node"
                  data-node={n.symbol}
                  data-dragging={drag?.id === n.symbol}
                  role="button"
                  tabIndex={0}
                  aria-pressed={linked}
                  aria-label={`${n.symbol}, ${n.sector}, ${n.degree} ${n.degree === 1 ? "link" : "links"}`}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    setSymbol(n.symbol);
                  }}
                >
                  <circle cx={x} cy={y} r={r + 8} fill="transparent" />
                  {/* The selected symbol gets a ring and a bold label, not a different colour. */}
                  {linked && <circle cx={x} cy={y} r={r * 1.25 + 5} fill="none" strokeWidth={1.5} strokeDasharray="3 3" style={{ stroke: "var(--wb-text)" }} />}
                  <Mark shape={shapeOf(n.sector)} x={x} y={y} r={r} strokeWidth={linked ? 3 : 1.5} style={{ fill: n.degree ? "var(--wb-accent)" : "var(--wb-canvas)", stroke: linked ? "var(--wb-text)" : n.degree ? "var(--wb-canvas)" : "var(--wb-accent)" }} />
                  <text x={x + r * 1.25 + 5} y={y} className={linked ? "st-label st-strong" : "st-label"} dominantBaseline="central">
                    {n.symbol}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div className="st-legend sx-legend">
        {SECTORS.map((sector) => (
          <span key={sector} className="sx-key">
            <svg width={14} height={14} aria-hidden>
              <Mark shape={shapeOf(sector)} x={7} y={7} r={5} style={{ fill: "var(--wb-accent)" }} />
            </svg>
            {sector}
          </span>
        ))}
        <span className="sx-key">
          <svg width={26} height={14} aria-hidden>
            <line x1={1} y1={7} x2={25} y2={7} strokeWidth={3} style={{ stroke: "var(--wb-good)" }} />
          </svg>
          positive
        </span>
        <span className="sx-key">
          <svg width={26} height={14} aria-hidden>
            <line x1={1} y1={7} x2={25} y2={7} strokeWidth={3} strokeDasharray="7 5" style={{ stroke: "var(--wb-bad)" }} />
          </svg>
          negative
        </span>
        <span>line width: strength   mark size: number of links   hollow: no links</span>
      </div>
    </div>
  );
}

export const networkTool = defineTool<State>({
  id: "network",
  title: "Correlation network",
  glyph: "⚯",
  category: "Showcase",
  version: 1,
  stateSchema,
  defaultState: () => ({ threshold: 0.3, method: "pearson", overrides: {} }),
  links: ["symbol"],
  component: NetworkView,
  describe: (state, { links }) => {
    const network = buildNetwork(correlationMatrix({ method: state.method }), state.threshold);
    return {
      note: "Sample data: correlation of daily returns over the synthetic history. Two symbols are linked when the absolute correlation reaches the threshold.",
      threshold: state.threshold,
      method: state.method,
      selected: links.symbol ?? null,
      nodes: network.nodes,
      edges: network.edges.map((e) => ({ a: e.a, b: e.b, correlation: Number(e.value.toFixed(3)) })),
      isolated: network.isolated,
      movedByHand: Object.keys(state.overrides),
    };
  },
});
