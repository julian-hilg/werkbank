import { Select, defineTool, openContextMenu, useLink, useToolState, useWerkbank } from "@werkbank/framework";
import { useState } from "react";
import { z } from "zod";
import { useTasks } from "../tasks/hooks";
import { OWNERS, STATUSES, STATUS_LABEL, tasks as store, type Status, type Task } from "../tasks/store";

const stateSchema = z.object({ owner: z.enum(["all", ...OWNERS]) });
type State = z.infer<typeof stateSchema>;

const DRAG_TYPE = "application/x-task-id";
const today = () => new Date().toISOString().slice(0, 10);
const visible = (all: Task[], state: State) => all.filter((t) => state.owner === "all" || t.owner === state.owner);

function Board() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const [selected, setSelected] = useLink<string | null>("task");
  const [over, setOver] = useState<Status | null>(null);
  const rows = visible(useTasks(), state);
  const move = (id: string, status: Status) => void wb.run("task.update", { id, patch: { status } });

  return (
    <div className="st-board-wrap">
      <div className="wb-toolhead">
        <Select value={state.owner} aria-label="Owner filter" options={[{ value: "all", label: "Everyone" }, ...OWNERS.map((o) => ({ value: o, label: o }))] as { value: State["owner"]; label: string }[]} onChange={(owner) => setState({ owner })} />
        <span>Drag a card to change its status, or use its arrows.</span>
      </div>
      <div className="st-board">
        {STATUSES.map((status, column) => {
          const cards = rows.filter((t) => t.status === status);
          return (
            <section
              key={status}
              className="st-column"
              data-over={over === status || undefined}
              aria-label={STATUS_LABEL[status]}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData(DRAG_TYPE);
                if (id && store.get(id)?.status !== status) move(id, status);
              }}
            >
              <h3>
                {STATUS_LABEL[status]} <span className="wb-badge">{cards.length}</span>
              </h3>
              {cards.map((t) => (
                <article
                  key={t.id}
                  className="st-card"
                  draggable
                  tabIndex={0}
                  aria-selected={t.id === selected}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, t.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => setSelected(t.id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelected(t.id)}
                  onContextMenu={(e) =>
                    openContextMenu(wb, e, [
                      { label: "Edit in the form", run: () => setSelected(t.id) },
                      { heading: "Move to" },
                      ...STATUSES.map((s) => ({ label: STATUS_LABEL[s], checked: t.status === s, run: () => move(t.id, s) })),
                      { separator: true },
                      { label: "Delete task", danger: true, run: () => void wb.run("task.delete", { id: t.id }) },
                    ])
                  }
                >
                  <div className="st-card-title">{t.title}</div>
                  <div className="st-card-meta">
                    <span>{t.id}</span>
                    <span>{t.owner}</span>
                    <span>{t.priority}</span>
                    {t.due && <span>{t.due < today() && t.status !== "done" ? `overdue ${t.due}` : t.due}</span>}
                    {t.blocked && <span className="wb-badge" data-tone="warn">blocked</span>}
                  </div>
                  <div className="st-card-moves">
                    <button className="wb-tool-button" disabled={column === 0} aria-label={`Move ${t.id} left`} onClick={(e) => (e.stopPropagation(), move(t.id, STATUSES[column - 1]!))}>
                      ◂
                    </button>
                    <button className="wb-tool-button" disabled={column === STATUSES.length - 1} aria-label={`Move ${t.id} right`} onClick={(e) => (e.stopPropagation(), move(t.id, STATUSES[column + 1]!))}>
                      ▸
                    </button>
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export const board = defineTool<State>({
  id: "board",
  title: "Board",
  glyph: "▥",
  category: "Tasks",
  version: 1,
  stateSchema,
  defaultState: () => ({ owner: "all" }),
  links: ["task"],
  component: Board,
  describe: (state, { links }) => ({
    selected: links.task ?? null,
    owner: state.owner,
    note: "Sample task data grouped by status.",
    columns: Object.fromEntries(
      STATUSES.map((s) => [s, visible(store.getAll(), state).filter((t) => t.status === s).map((t) => ({ id: t.id, title: t.title, owner: t.owner, blocked: t.blocked }))]),
    ),
  }),
});
