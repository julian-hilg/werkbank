import { defineTool, useToolState } from "@werkbank/framework";
import { useMemo, useRef, useState, type PointerEvent } from "react";
import { z } from "zod";
import { DEFAULT_PARAMS, build, paramsSchema, properties, type Params, type Vec } from "../cad/bracket";
import { downloadSvg, downloadText, useBox } from "./lib";

const stateSchema = z.object({
  params: paramsSchema,
  yaw: z.number().min(-180).max(180),
  pitch: z.number().min(-90).max(90),
  dimensions: z.boolean(),
});
type State = z.infer<typeof stateSchema>;

const VIEWS = { Iso: [-35, 28], Front: [0, 0], Top: [0, 90], Right: [-90, 0] } as const;
const FIELDS: { key: keyof Params; label: string; step: number }[] = [
  { key: "width", label: "Width", step: 1 },
  { key: "depth", label: "Depth", step: 1 },
  { key: "height", label: "Height", step: 1 },
  { key: "thickness", label: "Thickness", step: 0.5 },
  { key: "holeDiameter", label: "Hole diameter", step: 0.5 },
  { key: "holes", label: "Holes per plate", step: 1 },
];
const limits = (key: keyof Params) => {
  const field = paramsSchema.shape[key] as z.ZodNumber;
  return { min: field.minValue ?? 0, max: field.maxValue ?? 100 };
};

function Cad() {
  const [state, setState] = useToolState<State>();
  const [ref, box] = useBox<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [angle, setAngle] = useState<{ yaw: number; pitch: number } | null>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const yaw = angle?.yaw ?? state.yaw;
  const pitch = angle?.pitch ?? state.pitch;
  const model = useMemo(() => build(state.params), [state.params]);
  const props = properties(state.params);
  const [w, d, h] = model.size;

  // Orthographic projection: turn about the vertical axis, then tilt.
  const [sy, cy] = [Math.sin((yaw * Math.PI) / 180), Math.cos((yaw * Math.PI) / 180)];
  const [sp, cp] = [Math.sin((pitch * Math.PI) / 180), Math.cos((pitch * Math.PI) / 180)];
  const flat = ([x, y, z]: Vec): [number, number] => {
    const [px, py, pz] = [x - w / 2, y - d / 2, z - h / 2];
    const xr = px * cy - py * sy;
    const yr = px * sy + py * cy;
    return [xr, -(pz * cp - yr * sp)];
  };
  const extent = Math.hypot(w, d, h);
  const scale = Math.max(0.01, (Math.min(box.width, box.height) - 44) / extent);
  const at = (v: Vec): [number, number] => {
    const [x, y] = flat(v);
    return [box.width / 2 + x * scale, box.height / 2 + y * scale];
  };
  const dims: { from: Vec; to: Vec; text: string }[] = [
    { from: [0, d + 12, 0], to: [w, d + 12, 0], text: `${w}` },
    { from: [w + 12, 0, 0], to: [w + 12, d, 0], text: `${d}` },
    { from: [w + 12, 0, 0], to: [w + 12, 0, h], text: `${h}` },
  ];

  const set = (key: keyof Params, value: number) => {
    const { min, max } = limits(key);
    if (Number.isFinite(value)) setState({ ...state, params: { ...state.params, [key]: Math.min(max, Math.max(min, value)) } });
  };

  return (
    <div className="st-cad">
      <form className="st-cad-form" onSubmit={(e) => e.preventDefault()}>
        <strong>L-bracket</strong>
        {FIELDS.map(({ key, label, step }) => {
          const { min, max } = limits(key);
          return (
            <div key={key} className="wb-control">
              <label htmlFor={`cad-${key}`}>
                {label} {key === "holes" ? "" : "(mm)"}
              </label>
              <div className="st-slider">
                <input id={`cad-${key}`} type="range" min={min} max={max} step={step} value={state.params[key]} onChange={(e) => set(key, Number(e.target.value))} />
                <input className="wb-input wb-num" type="number" min={min} max={max} step={step} value={state.params[key]} aria-label={`${label} value`} onChange={(e) => set(key, Number(e.target.value))} />
              </div>
            </div>
          );
        })}
        <dl className="st-props">
          <dt>Volume</dt>
          <dd className="wb-num">{(props.volumeMm3 / 1000).toFixed(1)} cm³</dd>
          <dt>Mass (steel)</dt>
          <dd className="wb-num">{props.massGrams.toFixed(0)} g</dd>
          <dt>Hole pitch</dt>
          <dd className="wb-num">{props.holePitchMm.toFixed(1)} mm</dd>
        </dl>
        {model.problems.map((problem) => (
          <p key={problem} className="wb-hint wb-warn" role="alert">
            {problem}
          </p>
        ))}
        <div className="wb-form-actions">
          <button type="button" className="wb-button" onClick={() => setState({ ...state, params: DEFAULT_PARAMS })}>
            Reset
          </button>
          <button type="button" className="wb-button" onClick={() => downloadText("bracket.json", JSON.stringify({ part: "L-bracket", unit: "mm", ...state.params, ...props }, null, 2), "application/json")}>
            JSON
          </button>
          <button type="button" className="wb-button" onClick={() => downloadSvg("bracket.svg", svg.current)}>
            SVG
          </button>
        </div>
      </form>
      <div className="st-cad-view">
        <div className="wb-toolhead">
          <span className="wb-segment" role="group" aria-label="View">
            {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((name) => (
              <button key={name} className="wb-button" aria-pressed={state.yaw === VIEWS[name][0] && state.pitch === VIEWS[name][1]} onClick={() => setState({ ...state, yaw: VIEWS[name][0], pitch: VIEWS[name][1] })}>
                {name}
              </button>
            ))}
          </span>
          <label className="st-check">
            <input type="checkbox" checked={state.dimensions} onChange={(e) => setState({ ...state, dimensions: e.target.checked })} />
            dimensions
          </label>
          <span className="st-dim">drag to orbit</span>
        </div>
        <div ref={ref} className="st-fill">
          {box.width > 0 && (
            <svg
              ref={svg}
              width={box.width}
              height={box.height}
              className="st-grab"
              role="img"
              aria-label={`Wireframe of an L-bracket ${w} by ${d} by ${h} millimetres`}
              onPointerDown={(e: PointerEvent) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, yaw, pitch };
              }}
              onPointerMove={(e) => {
                const s = drag.current;
                if (!s) return;
                const nextYaw = ((((s.yaw + (e.clientX - s.x) * 0.5 + 180) % 360) + 360) % 360) - 180;
                setAngle({ yaw: nextYaw, pitch: Math.min(90, Math.max(-90, s.pitch + (e.clientY - s.y) * 0.5)) });
              }}
              onPointerUp={() => {
                drag.current = null;
                if (angle) setState({ ...state, yaw: Math.round(angle.yaw), pitch: Math.round(angle.pitch) });
                setAngle(null);
              }}
            >
              <path
                fill="none"
                strokeWidth={1.25}
                strokeLinecap="round"
                style={{ stroke: model.problems.length ? "var(--wb-bad)" : "var(--wb-text)" }}
                d={model.lines.map(([a, b]) => `M${at(a).map((n) => n.toFixed(1)).join(" ")}L${at(b).map((n) => n.toFixed(1)).join(" ")}`).join("")}
              />
              {state.dimensions &&
                dims.map((dim, i) => {
                  const [a, b] = [at(dim.from), at(dim.to)];
                  return (
                    <g key={i}>
                      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={1} style={{ stroke: "var(--wb-accent)" }} />
                      <circle cx={a[0]} cy={a[1]} r={2} style={{ fill: "var(--wb-accent)" }} />
                      <circle cx={b[0]} cy={b[1]} r={2} style={{ fill: "var(--wb-accent)" }} />
                      <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 4} className="st-label" textAnchor="middle" style={{ fill: "var(--wb-accent)" }}>
                        {dim.text}
                      </text>
                    </g>
                  );
                })}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

export const cadTool = defineTool<State>({
  id: "cad",
  title: "CAD part",
  glyph: "⬡",
  category: "Showcase",
  version: 1,
  stateSchema,
  defaultState: () => ({ params: DEFAULT_PARAMS, yaw: -35, pitch: 28, dimensions: true }),
  component: Cad,
  describe: (state) => {
    const props = properties(state.params);
    return {
      part: "L-bracket",
      unit: "mm",
      params: state.params,
      limits: Object.fromEntries(FIELDS.map((f) => [f.key, limits(f.key)])),
      derived: { volumeCm3: Number((props.volumeMm3 / 1000).toFixed(2)), massGramsSteel: Math.round(props.massGrams), holePitchMm: Number(props.holePitchMm.toFixed(2)) },
      problems: build(state.params).problems,
      note: "Change the part with panel.setState and a patch of { params: { ...all six values } }.",
    };
  },
});
