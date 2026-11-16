import { defineTool, useToolState, useWerkbank } from "@werkbank/framework";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { FAIL_EVERY, JOBS, JOB_STATUSES, type Job, type JobStatus } from "../pipeline/data";
import { directDownstream, layoutPipeline, reachable, runOrder } from "../pipeline/layout";
import { countByStatus, pipeline } from "../pipeline/store";
import { downloadSvg, useBox } from "./lib";

const stateSchema = z.object({
  orientation: z.enum(["lr", "tb"]),
  /** Id of the selected job. */
  selected: z.string().nullable(),
});
type State = z.infer<typeof stateSchema>;

/** Below this scale the labels stop being readable, so the panel scrolls instead. */
const MIN_SCALE = 0.7;
const ARROW = 7;
const whole = (n: number) => n.toLocaleString("en-US");
const nameOf = (id: string) => JOBS.find((j) => j.id === id)?.name ?? id;
const names = (ids: string[]) => (ids.length ? ids.map(nameOf).join(", ") : "none");
const summary = (counts: Record<JobStatus, number>) =>
  JOB_STATUSES.filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(", ");

/** A small mark per status, so the status never rests on colour alone. */
function StatusMark({ status, x, y }: { status: JobStatus; x: number; y: number }) {
  switch (status) {
    case "ok":
      return <circle cx={x} cy={y} r={4} style={{ fill: "var(--wb-good)" }} />;
    case "running":
      return <polygon points={`${x - 3.5},${y - 4.5} ${x + 4.5},${y} ${x - 3.5},${y + 4.5}`} style={{ fill: "var(--wb-accent)" }} />;
    case "failed":
      return <path d={`M${x - 3.5} ${y - 3.5}L${x + 3.5} ${y + 3.5}M${x + 3.5} ${y - 3.5}L${x - 3.5} ${y + 3.5}`} fill="none" strokeWidth={2.2} strokeLinecap="round" style={{ stroke: "var(--wb-bad)" }} />;
    case "stale":
      return <polygon points={`${x},${y - 4.5} ${x + 4.5},${y} ${x},${y + 4.5} ${x - 4.5},${y}`} strokeWidth={1.6} style={{ fill: "var(--wb-canvas)", stroke: "var(--wb-warn)" }} />;
    default:
      return <circle cx={x} cy={y} r={3.5} strokeWidth={1.4} strokeDasharray="2 1.5" style={{ fill: "var(--wb-canvas)", stroke: "var(--wb-text-dim)" }} />;
  }
}

function Pipeline() {
  const [state, setState] = useToolState<State>();
  const wb = useWerkbank();
  const [ref, box] = useBox<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const run = useSyncExternalStore(pipeline.subscribe, pipeline.getState);
  const layout = useMemo(() => layoutPipeline(JOBS, state.orientation), [state.orientation]);
  const at = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const selected = JOBS.find((j) => j.id === state.selected) ?? null;
  const related = useMemo(
    () => (selected ? { up: reachable(JOBS, selected.id, "upstream"), down: reachable(JOBS, selected.id, "downstream") } : null),
    [selected],
  );
  /** With a selection, only the job and what it depends on, or what depends on it, stays at full strength. */
  const nodeOn = (id: string) => !related || !selected || id === selected.id || related.up.has(id) || related.down.has(id);
  const edgeOn = (from: string, to: string) => {
    if (!related || !selected) return false;
    const inUp = (id: string) => id === selected.id || related.up.has(id);
    const inDown = (id: string) => id === selected.id || related.down.has(id);
    return (inUp(from) && inUp(to)) || (inDown(from) && inDown(to));
  };

  // Fit the graph to the panel; when that would make it too small to read, keep it legible and let the panel scroll.
  const fit = box.width > 0 && box.height > 0 ? Math.min(1, box.width / layout.width, box.height / layout.height) : 0;
  const scale = Math.max(MIN_SCALE, fit);
  const width = Math.max(box.width, Math.ceil(layout.width * scale));
  const height = Math.max(box.height, Math.ceil(layout.height * scale));
  const dx = (width - layout.width * scale) / 2;
  const dy = (height - layout.height * scale) / 2;
  const { nodeWidth: nw, nodeHeight: nh } = layout;
  const lr = state.orientation === "lr";

  const status = (id: string) => run.statuses[id] ?? "waiting";
  const counts = countByStatus(run);
  const shown = JOBS.find((j) => j.id === hover) ?? selected;
  const detail = (job: Job) =>
    `${job.name} (${job.kind})   status ${status(job.id)}   last run ${job.durationSec} s   ${job.kind === "check" ? "no rows (a check)" : `${whole(job.rowsOut)} rows`}   upstream: ${names(job.upstream)}   downstream: ${names(directDownstream(JOBS, job.id))}`;
  const select = (id: string | null) => id !== state.selected && setState({ ...state, selected: id });

  return (
    <div className="st-chart">
      <div className="wb-toolhead">
        <strong>Pipeline</strong>
        <span className="wb-badge">sample data</span>
        <span className="wb-num">
          {JOBS.length} jobs: {summary(counts)}
          {run.runs > 0 ? `   run ${run.runs}` : ""}
        </span>
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="Orientation">
          {(["lr", "tb"] as const).map((orientation) => (
            <button key={orientation} className="wb-button" aria-pressed={state.orientation === orientation} onClick={() => setState({ ...state, orientation })}>
              {orientation === "lr" ? "Left to right" : "Top to bottom"}
            </button>
          ))}
        </span>
        <button className="wb-button" title={`A sample run takes a few seconds; one check fails on every ${FAIL_EVERY}rd run`} onClick={() => void wb.run("pipeline.run")}>
          Run pipeline
        </button>
        <button className="wb-button" onClick={() => void wb.run("pipeline.reset")}>
          Reset
        </button>
        <button className="wb-button" onClick={() => downloadSvg("pipeline.svg", svg.current)}>
          SVG
        </button>
      </div>
      <div className="st-readout wb-num">{shown ? detail(shown) : "Click a job to see what it depends on and what depends on it. Click the background to clear."}</div>
      <div ref={ref} className="sx-scroll">
        {fit > 0 && (
          <svg
            ref={svg}
            className="sx-pipeline"
            width={width}
            height={height}
            role="img"
            aria-label={`Sample data pipeline of ${JOBS.length} jobs: ${summary(counts)}`}
            onPointerLeave={() => setHover(null)}
            onClick={() => select(null)}
          >
            <g transform={`translate(${dx} ${dy}) scale(${scale})`}>
              {JOBS.flatMap((job) =>
                job.upstream.map((from) => {
                  const a = at.get(from);
                  const b = at.get(job.id);
                  if (!a || !b) return null;
                  const on = edgeOn(from, job.id);
                  // Leave the source at the middle of its far side, arrive at the middle of the target's near side.
                  const [sx, sy] = lr ? [a.x + nw, a.y + nh / 2] : [a.x + nw / 2, a.y + nh];
                  const [ex, ey] = lr ? [b.x, b.y + nh / 2] : [b.x + nw / 2, b.y];
                  const path = lr
                    ? `M${sx} ${sy}C${(sx + ex) / 2} ${sy} ${(sx + ex) / 2} ${ey} ${ex - ARROW} ${ey}`
                    : `M${sx} ${sy}C${sx} ${(sy + ey) / 2} ${ex} ${(sy + ey) / 2} ${ex} ${ey - ARROW}`;
                  const head = lr ? `${ex},${ey} ${ex - ARROW},${ey - 4} ${ex - ARROW},${ey + 4}` : `${ex},${ey} ${ex - 4},${ey - ARROW} ${ex + 4},${ey - ARROW}`;
                  return (
                    <g key={`${from}>${job.id}`} className="sx-edge" data-on={on} style={{ opacity: selected && !on ? 0.22 : 1 }}>
                      <path d={path} fill="none" />
                      <polygon points={head} />
                    </g>
                  );
                }),
              )}
              {JOBS.map((job) => {
                const n = at.get(job.id);
                if (!n) return null;
                const s = status(job.id);
                const isSelected = selected?.id === job.id;
                return (
                  <g
                    key={job.id}
                    className="sx-node"
                    data-job={job.id}
                    data-selected={isSelected}
                    data-status={s}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${job.name}, ${job.kind}, ${s}`}
                    style={{ opacity: nodeOn(job.id) ? 1 : 0.3 }}
                    onPointerEnter={() => setHover(job.id)}
                    onPointerLeave={() => setHover(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      select(isSelected ? null : job.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      select(isSelected ? null : job.id);
                    }}
                  >
                    <rect x={n.x} y={n.y} width={nw} height={nh} rx={7} />
                    <text x={n.x + 10} y={n.y + 20} className="sx-node-name">
                      {job.name}
                    </text>
                    <StatusMark status={s} x={n.x + 14} y={n.y + 36} />
                    <text x={n.x + 23} y={n.y + 36} className="st-label" dominantBaseline="central">
                      {s}
                    </text>
                    <text x={n.x + nw - 10} y={n.y + 36} className="st-axis" textAnchor="end" dominantBaseline="central">
                      {job.kind}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}

export const pipelineTool = defineTool<State>({
  id: "pipeline",
  title: "Pipeline",
  glyph: "⇶",
  category: "Showcase",
  version: 1,
  stateSchema,
  defaultState: () => ({ orientation: "lr", selected: null }),
  component: Pipeline,
  describe: (state) => {
    const run = pipeline.getState();
    const selected = JOBS.find((j) => j.id === state.selected);
    return {
      note: "Sample data: an invented pipeline. Durations and row counts are made up, and a run only advances statuses on timers.",
      orientation: state.orientation,
      runs: run.runs,
      running: pipeline.isRunning(),
      counts: countByStatus(run),
      jobs: JOBS.map((j) => ({ id: j.id, name: j.name, kind: j.kind, status: run.statuses[j.id] ?? "waiting", durationSec: j.durationSec, rowsOut: j.rowsOut })),
      edges: JOBS.flatMap((j) => j.upstream.map((from) => ({ from, to: j.id }))),
      runOrder: runOrder(JOBS),
      selected: selected
        ? {
            id: selected.id,
            name: selected.name,
            status: run.statuses[selected.id] ?? "waiting",
            upstream: selected.upstream,
            downstream: directDownstream(JOBS, selected.id),
            allUpstream: [...reachable(JOBS, selected.id, "upstream")],
            allDownstream: [...reachable(JOBS, selected.id, "downstream")],
          }
        : null,
    };
  },
});
