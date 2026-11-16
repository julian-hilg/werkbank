import { defineTool, useDoc, useLink, useToolState } from "@werkbank/framework";
import { useCallback, useMemo, useRef, useState, type PointerEvent } from "react";
import { z } from "zod";
import { SymbolSearch } from "./SymbolSearch";
import { EXPIRIES, MONEYNESS, volSurface } from "../market/analytics";
import { isSymbol, type SymbolId } from "../market/history";
import { useCanvas, type Surface } from "./canvas";
import { downloadCanvas, downloadCsv, mixer, sequential, useBox } from "./lib";

const stateSchema = z.object({
  view: z.enum(["surface", "smiles"]),
  /** Rotation about the vertical axis, degrees. */
  yaw: z.number().min(-180).max(180),
  /** Tilt towards the viewer, degrees. */
  pitch: z.number().min(10).max(80),
});
type State = z.infer<typeof stateSchema>;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const NOTE = "Synthetic parametric surface: level from realised volatility plus an invented skew and smile. Not fitted to option quotes.";

interface Projected {
  x: number;
  y: number;
  depth: number;
}

function Surface3d({ symbol, state, setState }: { symbol: SymbolId; state: State; setState: (s: State) => void }) {
  const theme = useDoc((doc) => doc.shell.theme);
  const surface = useMemo(() => volSurface(symbol), [symbol]);
  const [angle, setAngle] = useState<{ yaw: number; pitch: number } | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const points = useRef<{ i: number; j: number; x: number; y: number }[]>([]);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const yaw = angle?.yaw ?? state.yaw;
  const pitch = angle?.pitch ?? state.pitch;

  const draw = useCallback(
    ({ g, width, height, token }: Surface) => {
      g.clearRect(0, 0, width, height);
      const { iv } = surface;
      const flat = iv.flat();
      const lo = Math.min(...flat);
      const hi = Math.max(...flat);
      const colour = mixer(token);
      const ny = EXPIRIES.length;
      const nx = MONEYNESS.length;
      const scale = Math.min(width * 0.27, height * 0.4);
      const cx = width / 2 - 16;
      const cy = height * 0.58;
      const [sinY, cosY] = [Math.sin((yaw * Math.PI) / 180), Math.cos((yaw * Math.PI) / 180)];
      const [sinP, cosP] = [Math.sin((pitch * Math.PI) / 180), Math.cos((pitch * Math.PI) / 180)];
      const project = (u: number, v: number, w: number): Projected => {
        // u: strike axis, v: maturity axis, both -1..1; w: height 0..1
        const xr = u * cosY - v * sinY;
        const yr = u * sinY + v * cosY;
        return { x: cx + xr * scale, y: cy + yr * scale * sinP * 0.75 - w * scale * 0.85 * cosP, depth: yr };
      };
      const at = (i: number, j: number) => project((j / (nx - 1)) * 2 - 1, (i / (ny - 1)) * 2 - 1, (iv[i]![j]! - lo) / (hi - lo || 1));

      // Floor grid, so the surface reads as sitting in a box.
      g.strokeStyle = token("--wb-grid");
      g.lineWidth = 1;
      for (let k = 0; k <= 4; k++) {
        const t = (k / 4) * 2 - 1;
        for (const [a, b] of [[project(t, -1, 0), project(t, 1, 0)], [project(-1, t, 0), project(1, t, 0)]] as const) {
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
      }

      // Painter's algorithm: far patches first.
      const quads: { corners: Projected[]; depth: number; level: number }[] = [];
      for (let i = 0; i < ny - 1; i++) {
        for (let j = 0; j < nx - 1; j++) {
          const corners = [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)];
          const level = (iv[i]![j]! + iv[i]![j + 1]! + iv[i + 1]![j + 1]! + iv[i + 1]![j]!) / 4;
          quads.push({ corners, depth: corners.reduce((s, c) => s + c.depth, 0) / 4, level: (level - lo) / (hi - lo || 1) });
        }
      }
      quads.sort((a, b) => a.depth - b.depth);
      for (const quad of quads) {
        g.beginPath();
        quad.corners.forEach((c, k) => (k ? g.lineTo(c.x, c.y) : g.moveTo(c.x, c.y)));
        g.closePath();
        g.fillStyle = colour.sequential(quad.level);
        g.fill();
        g.strokeStyle = token("--wb-canvas");
        g.lineWidth = 0.75;
        g.stroke();
      }

      // At-the-money line.
      const atm = MONEYNESS.indexOf(1);
      g.strokeStyle = token("--wb-text");
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i < ny; i++) {
        const p = at(i, atm);
        if (i) g.lineTo(p.x, p.y);
        else g.moveTo(p.x, p.y);
      }
      g.stroke();

      // Axis labels on the floor edges nearest the viewer.
      g.fillStyle = token("--wb-text-dim");
      g.textAlign = "center";
      g.textBaseline = "top";
      const nearV = cosY >= 0 ? 1 : -1;
      const nearU = sinY >= 0 ? 1 : -1;
      for (const j of [0, 3, 6, 9, 12]) {
        const p = project((j / (nx - 1)) * 2 - 1, nearV * 1.12, 0);
        g.fillText(`${Math.round(MONEYNESS[j]! * 100)}%`, p.x, p.y);
      }
      for (let i = 0; i < ny; i++) {
        const p = project(nearU * 1.14, (i / (ny - 1)) * 2 - 1, 0);
        g.fillText(`${EXPIRIES[i]}d`, p.x, p.y);
      }
      const strikeTitle = project(0, nearV * 1.34, 0);
      g.fillText("strike, % of spot", strikeTitle.x, strikeTitle.y);
      const expiryTitle = project(nearU * 1.42, 0, 0);
      g.fillText("maturity", expiryTitle.x, expiryTitle.y);

      // Colour key: the vertical axis and the colour both show implied volatility.
      const keyH = Math.min(140, height * 0.45);
      const keyX = width - 22;
      const keyY = (height - keyH) / 2;
      for (let k = 0; k < keyH; k++) {
        g.fillStyle = colour.sequential(1 - k / keyH);
        g.fillRect(keyX, keyY + k, 10, 1.5);
      }
      g.fillStyle = token("--wb-text-dim");
      g.textAlign = "right";
      g.textBaseline = "middle";
      g.fillText(pct(hi), keyX - 4, keyY);
      g.fillText(pct(lo), keyX - 4, keyY + keyH);
      g.fillText("IV", keyX + 8, keyY - 12);

      points.current = [];
      for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) points.current.push({ i, j, ...at(i, j) });
      if (hover) {
        const p = at(hover[0], hover[1]);
        g.beginPath();
        g.arc(p.x, p.y, 5, 0, Math.PI * 2);
        g.fillStyle = token("--wb-text");
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = token("--wb-canvas");
        g.stroke();
      }
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
    },
    [surface, yaw, pitch, hover, theme],
  );
  const canvas = useCanvas(draw);

  const nearest = (e: PointerEvent): [number, number] | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const [mx, my] = [e.clientX - rect.left, e.clientY - rect.top];
    let best: { d: number; i: number; j: number } | null = null;
    for (const p of points.current) {
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (!best || d < best.d) best = { d, i: p.i, j: p.j };
    }
    return best && best.d < 30 ** 2 ? [best.i, best.j] : null;
  };

  return (
    <>
      <div className="st-readout wb-num">
        {hover
          ? `${EXPIRIES[hover[0]]} days   strike ${Math.round(MONEYNESS[hover[1]]! * 100)}% of spot   implied vol ${pct(surface.iv[hover[0]]![hover[1]]!)}`
          : "Drag to rotate. Hover a point for its value. The dark line is at-the-money."}
      </div>
      <canvas
        ref={canvas}
        className="st-canvas st-grab"
        role="img"
        aria-label={`Implied volatility surface of ${symbol} by strike and maturity`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, yaw, pitch };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return setHover(nearest(e));
          const nextYaw = ((((d.yaw + (e.clientX - d.x) * 0.5 + 180) % 360) + 360) % 360) - 180;
          setAngle({ yaw: nextYaw, pitch: Math.min(80, Math.max(10, d.pitch + (e.clientY - d.y) * 0.3)) });
        }}
        onPointerUp={() => {
          drag.current = null;
          if (angle) setState({ ...state, yaw: Math.round(angle.yaw), pitch: Math.round(angle.pitch) });
          setAngle(null);
        }}
        onPointerLeave={() => setHover(null)}
      />
    </>
  );
}

/** One line per maturity. Maturity is ordered, so the lines share one hue from light (short) to dark (long). */
function Smiles({ symbol }: { symbol: SymbolId }) {
  const [ref, box] = useBox<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const { iv } = useMemo(() => volSurface(symbol), [symbol]);
  const pad = { left: 44, right: 46, top: 10, bottom: 30 };
  const w = Math.max(0, box.width - pad.left - pad.right);
  const h = Math.max(0, box.height - pad.top - pad.bottom);
  const lo = Math.min(...iv.flat());
  const hi = Math.max(...iv.flat());
  const x = (j: number) => pad.left + (j / (MONEYNESS.length - 1)) * w;
  const y = (v: number) => pad.top + (1 - (v - lo) / (hi - lo || 1)) * h;
  return (
    <>
      <div className="st-readout wb-num">
        {hover !== null
          ? `strike ${Math.round(MONEYNESS[hover]! * 100)}%   ` + EXPIRIES.map((d, i) => `${d}d ${pct(iv[i]![hover]!)}`).join("   ")
          : "Implied volatility by strike, one line per maturity. Hover for values."}
      </div>
      <div ref={ref} className="st-fill">
        {box.width > 0 && (
          <svg
            width={box.width}
            height={box.height}
            role="img"
            aria-label={`Volatility smiles of ${symbol}`}
            onPointerMove={(e) => {
              const t = (e.clientX - e.currentTarget.getBoundingClientRect().left - pad.left) / (w || 1);
              setHover(Math.round(Math.min(1, Math.max(0, t)) * (MONEYNESS.length - 1)));
            }}
            onPointerLeave={() => setHover(null)}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const v = lo + (hi - lo) * t;
              return (
                <g key={t}>
                  <line x1={pad.left} x2={pad.left + w} y1={y(v)} y2={y(v)} className="st-gridline" />
                  <text x={pad.left - 6} y={y(v)} className="st-axis" textAnchor="end" dominantBaseline="middle">
                    {pct(v)}
                  </text>
                </g>
              );
            })}
            {[0, 3, 6, 9, 12].map((j) => (
              <text key={j} x={x(j)} y={pad.top + h + 14} className="st-axis" textAnchor="middle">
                {Math.round(MONEYNESS[j]! * 100)}%
              </text>
            ))}
            <text x={pad.left + w / 2} y={pad.top + h + 27} className="st-axis" textAnchor="middle">
              strike, % of spot
            </text>
            {iv.map((row, i) => (
              <g key={i}>
                <polyline
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  style={{ stroke: sequential(0.25 + (i / (EXPIRIES.length - 1)) * 0.75) }}
                  points={row.map((v, j) => `${x(j)},${y(v)}`).join(" ")}
                />
                <text x={pad.left + w + 5} y={y(row[row.length - 1]!)} className="st-axis" dominantBaseline="middle">
                  {EXPIRIES[i]}d
                </text>
              </g>
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + h} className="st-crosshair" />}
          </svg>
        )}
      </div>
    </>
  );
}

function VolSurface() {
  const [state, setState] = useToolState<State>();
  const [symbol, setSymbol] = useLink<SymbolId>("symbol");
  if (!symbol) return <p className="st-blank">No symbol. Link this panel to a group, or pick a symbol in a watchlist.</p>;
  const exportCsv = () => {
    const { iv } = volSurface(symbol);
    downloadCsv(`${symbol}-vol-surface.csv`, ["days", ...MONEYNESS.map((m) => `${Math.round(m * 100)}%`)], iv.map((row, i) => [EXPIRIES[i]!, ...row.map((v) => v.toFixed(4))]));
  };
  return (
    <div className="st-chart" data-export-root>
      <div className="wb-toolhead">
        <SymbolSearch symbol={symbol} onPick={setSymbol} />
        <span className="wb-badge">synthetic</span>
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="View">
          {(["surface", "smiles"] as const).map((view) => (
            <button key={view} className="wb-button" aria-pressed={state.view === view} onClick={() => setState({ ...state, view })}>
              {view === "surface" ? "Surface" : "Smiles"}
            </button>
          ))}
        </span>
        <button className="wb-button" onClick={exportCsv}>
          CSV
        </button>
        {state.view === "surface" && (
          <button className="wb-button" onClick={(e) => downloadCanvas(`${symbol}-vol-surface.png`, e.currentTarget.closest("[data-export-root]")!.querySelector("canvas"))}>
            PNG
          </button>
        )}
      </div>
      {state.view === "surface" ? <Surface3d symbol={symbol} state={state} setState={setState} /> : <Smiles symbol={symbol} />}
    </div>
  );
}

export const volSurfaceTool = defineTool<State>({
  id: "vol-surface",
  title: "Vol surface",
  glyph: "◭",
  category: "Analytics",
  version: 1,
  stateSchema,
  defaultState: () => ({ view: "surface", yaw: -35, pitch: 32 }),
  links: ["symbol"],
  component: VolSurface,
  describe: (state, { links }) => {
    if (!isSymbol(links.symbol)) return { symbol: null };
    const s = volSurface(links.symbol);
    return {
      symbol: links.symbol, view: state.view, note: NOTE,
      expiriesDays: s.expiries, strikesPctOfSpot: s.moneyness.map((m) => Math.round(m * 100)),
      atTheMoneyByExpiry: s.atm.map((v) => Number(v.toFixed(4))),
      impliedVol: s.iv.map((row) => row.map((v) => Number(v.toFixed(4)))),
    };
  },
});
