import { defineTool, useLink, useToolState } from "@werkbank/framework";
import { useRef, useState } from "react";
import { z } from "zod";
import { useTasks } from "../tasks/hooks";
import { OWNERS, STATUS_LABEL, tasks as store, type Task } from "../tasks/store";
import { downloadSvg, useBox } from "./lib";

const stateSchema = z.object({ group: z.enum(["owner", "none"]), showDone: z.boolean() });
type State = z.infer<typeof stateSchema>;

const DAY = 86_400_000;
const HOURS_PER_DAY = 6;
const at = (date: string) => new Date(`${date}T00:00:00`).getTime();
const iso = (ms: number) => new Date(ms).toLocaleDateString("en-CA");

/** A task's bar: it ends on the due date and starts as many working days earlier as its estimate needs. */
export function schedule(tasks: Task[]) {
  return tasks
    .filter((t) => t.due)
    .map((t) => {
      const end = at(t.due!) + DAY;
      const days = Math.max(1, Math.ceil((t.estimateHours ?? HOURS_PER_DAY) / HOURS_PER_DAY));
      return { task: t, start: end - days * DAY, end, days };
    });
}

function Timeline() {
  const [state, setState] = useToolState<State>();
  const [selected, setSelected] = useLink<string | null>("task");
  const [ref, box] = useBox<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const all = useTasks();
  const bars = schedule(all.filter((t) => state.showDone || t.status !== "done"));
  const ordered = [...bars].sort((a, b) => (state.group === "owner" ? OWNERS.indexOf(a.task.owner) - OWNERS.indexOf(b.task.owner) : 0) || a.start - b.start);
  const undated = all.filter((t) => !t.due).length;
  const today = at(iso(Date.now()));

  const pad = { left: 150, right: 12, top: 22 };
  const rowH = 22;
  const lo = Math.min(today, ...bars.map((b) => b.start)) - DAY;
  const hi = Math.max(today + DAY, ...bars.map((b) => b.end)) + DAY;
  const w = Math.max(0, box.width - pad.left - pad.right);
  const x = (ms: number) => pad.left + ((ms - lo) / (hi - lo)) * w;
  const height = Math.max(box.height, pad.top + ordered.length * rowH + 8);
  const ticks: number[] = [];
  for (let t = lo - ((new Date(lo).getDay() + 6) % 7) * DAY + 7 * DAY; t < hi; t += 7 * DAY) ticks.push(t);
  const shown = ordered.find((b) => b.task.id === hover);

  return (
    <div className="st-chart">
      <div className="wb-toolhead">
        <strong>Timeline</strong>
        <span>{ordered.length} scheduled{undated ? `, ${undated} without a due date` : ""}</span>
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="Order">
          {(["owner", "none"] as const).map((group) => (
            <button key={group} className="wb-button" aria-pressed={state.group === group} onClick={() => setState({ ...state, group })}>
              {group === "owner" ? "By owner" : "By start"}
            </button>
          ))}
        </span>
        <label className="st-check">
          <input type="checkbox" checked={state.showDone} onChange={(e) => setState({ ...state, showDone: e.target.checked })} />
          done
        </label>
        <button className="wb-button" onClick={() => downloadSvg("timeline.svg", svg.current)}>
          SVG
        </button>
      </div>
      <div className="st-readout">
        {shown
          ? `${shown.task.id}  ${shown.task.title}   ${shown.task.owner}   ${STATUS_LABEL[shown.task.status]}   ${iso(shown.start)} to ${shown.task.due}   ${shown.task.estimateHours ?? "no"} h estimate`
          : "Each bar ends on the task's due date; its length is the estimate at six working hours a day."}
      </div>
      <div ref={ref} className="st-fill" style={{ overflow: "auto" }}>
        {box.width > 0 && (
          <svg ref={svg} width={box.width} height={height} role="img" aria-label="Task timeline" onPointerLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={pad.top} y2={height} className="st-gridline" />
                <text x={x(t)} y={pad.top - 8} className="st-axis" textAnchor="middle">
                  {new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </text>
              </g>
            ))}
            {ordered.map((b, i) => {
              const y = pad.top + i * rowH;
              const done = b.task.status === "done";
              const late = !done && b.end <= today;
              return (
                <g key={b.task.id} style={{ cursor: "pointer" }} onPointerEnter={() => setHover(b.task.id)} onClick={() => setSelected(b.task.id)}>
                  <rect x={0} y={y} width={box.width} height={rowH} style={{ fill: b.task.id === selected ? "var(--wb-hover)" : "transparent" }} />
                  <text x={8} y={y + rowH / 2} className={b.task.id === selected ? "st-label st-strong" : "st-label"} dominantBaseline="middle">
                    {state.group === "owner" ? `${b.task.owner} · ` : ""}
                    {b.task.title.length > 20 ? `${b.task.title.slice(0, 19)}…` : b.task.title}
                  </text>
                  <rect
                    x={x(b.start)}
                    y={y + 5}
                    width={Math.max(3, x(b.end) - x(b.start))}
                    height={rowH - 10}
                    rx={2}
                    strokeWidth={b.task.blocked ? 2 : 0}
                    strokeDasharray={b.task.blocked ? "3 2" : undefined}
                    style={{ fill: done ? "var(--wb-text-dim)" : "var(--wb-accent)", opacity: done ? 0.45 : 1, stroke: "var(--wb-warn)" }}
                  />
                  {/* State is written out, not left to colour alone. */}
                  {(late || b.task.blocked || done) && (
                    <text x={x(b.end) + 5} y={y + rowH / 2} className="st-axis" dominantBaseline="middle">
                      {[done && "done", late && "overdue", b.task.blocked && "blocked"].filter(Boolean).join(", ")}
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={x(today)} x2={x(today)} y1={pad.top - 4} y2={height} strokeWidth={1.5} strokeDasharray="4 3" style={{ stroke: "var(--wb-text)" }} />
            <text x={x(today) + 4} y={height - 6} className="st-label">
              today
            </text>
          </svg>
        )}
      </div>
    </div>
  );
}

export const timelineTool = defineTool<State>({
  id: "timeline",
  title: "Timeline",
  glyph: "▭",
  category: "Tasks",
  version: 1,
  stateSchema,
  defaultState: () => ({ group: "owner", showDone: true }),
  links: ["task"],
  component: Timeline,
  describe: (state, { links }) => ({
    selected: links.task ?? null,
    note: "Sample tasks. A bar ends on the due date and spans the estimate at six working hours a day.",
    bars: schedule(store.getAll().filter((t) => state.showDone || t.status !== "done")).map((b) => ({
      id: b.task.id, title: b.task.title, owner: b.task.owner, status: b.task.status, blocked: b.task.blocked, start: iso(b.start), due: b.task.due, days: b.days,
    })),
    withoutDueDate: store.getAll().filter((t) => !t.due).map((t) => t.id),
  }),
});
