import { Select, copyText, defineTool, openContextMenu, useLink, useToolState, useWerkbank } from "@werkbank/framework";
import { z } from "zod";
import { useTasks } from "../tasks/hooks";
import { PRIORITIES, STATUSES, STATUS_LABEL, tasks as store, type Task } from "../tasks/store";
import { downloadCsv } from "./lib";

const stateSchema = z.object({
  query: z.string().max(80),
  status: z.enum(["all", ...STATUSES]),
  sort: z.enum(["id", "due", "priority", "title"]),
});
type State = z.infer<typeof stateSchema>;

const rank = (t: Task) => PRIORITIES.length - PRIORITIES.indexOf(t.priority);
const select = (all: Task[], state: State): Task[] => {
  const q = state.query.trim().toLowerCase();
  const rows = all.filter(
    (t) =>
      (state.status === "all" || t.status === state.status) &&
      (!q || `${t.id} ${t.title} ${t.owner} ${t.tags.join(" ")}`.toLowerCase().includes(q)),
  );
  if (state.sort === "title") rows.sort((a, b) => a.title.localeCompare(b.title));
  if (state.sort === "priority") rows.sort((a, b) => rank(a) - rank(b));
  if (state.sort === "due") rows.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  return rows;
};

function TaskList() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const [selected, setSelected] = useLink<string | null>("task");
  const rows = select(useTasks(), state);
  const header = (key: State["sort"], text: string) => (
    <button className="st-sort" onClick={() => setState({ ...state, sort: key })}>
      {text}
      {state.sort === key ? " ▾" : ""}
    </button>
  );
  const create = async () => {
    const result = await wb.run("task.create", { title: "New task" });
    if (result.ok) setSelected((result.value as Task).id);
  };
  return (
    <>
      <div className="wb-toolhead">
        <input
          className="wb-input"
          type="search"
          value={state.query}
          placeholder="Search tasks"
          aria-label="Search tasks"
          style={{ maxWidth: 180 }}
          onChange={(e) => setState({ ...state, query: e.target.value })}
        />
        <Select value={state.status} aria-label="Status filter" options={[{ value: "all", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))] as { value: State["status"]; label: string }[]} onChange={(status) => setState({ ...state, status })} />
        <span>{rows.length} shown</span>
        <span className="st-grow" />
        <button
          className="wb-button"
          onClick={() =>
            downloadCsv("tasks.csv", ["id", "title", "owner", "status", "priority", "due", "estimate_hours", "blocked", "tags", "notes"], rows.map((t) => [t.id, t.title, t.owner, t.status, t.priority, t.due, t.estimateHours, t.blocked, t.tags.join(" "), t.notes]))
          }
        >
          CSV
        </button>
        <button className="wb-button" onClick={() => void create()}>
          New task
        </button>
      </div>
      <table className="wb-table">
        <thead>
          <tr>
            <th>{header("id", "ID")}</th>
            <th style={{ textAlign: "left" }}>{header("title", "Title")}</th>
            <th>Owner</th>
            <th>Status</th>
            <th>{header("priority", "Priority")}</th>
            <th>{header("due", "Due")}</th>
            <th>Est. h</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr
              key={t.id}
              aria-selected={t.id === selected}
              tabIndex={0}
              onClick={() => setSelected(t.id)}
              onKeyDown={(e) => e.key === "Enter" && setSelected(t.id)}
              onContextMenu={(e) =>
                openContextMenu(wb, e, [
                  { label: "Edit in the form", run: () => setSelected(t.id) },
                  { heading: "Status" },
                  ...STATUSES.map((status) => ({ label: STATUS_LABEL[status], checked: t.status === status, run: () => void wb.run("task.update", { id: t.id, patch: { status } }) })),
                  { separator: true },
                  { label: t.blocked ? "Mark as not blocked" : "Mark as blocked…", disabled: !t.blocked && !t.notes.trim(), hint: !t.blocked && !t.notes.trim() ? "needs a note" : undefined, run: () => void wb.run("task.update", { id: t.id, patch: { blocked: !t.blocked } }) },
                  { label: "Copy id and title", run: () => copyText(`${t.id} ${t.title}`) },
                  { separator: true },
                  { label: "Delete task", danger: true, run: () => void wb.run("task.delete", { id: t.id }) },
                ])
              }
            >
              <td>{t.id}</td>
              <td style={{ textAlign: "left" }}>
                {t.title}
                {t.blocked ? " (blocked)" : ""}
              </td>
              <td>{t.owner}</td>
              <td>{STATUS_LABEL[t.status]}</td>
              <td>{t.priority}</td>
              <td>{t.due ?? "–"}</td>
              <td>{t.estimateHours ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="st-blank">No tasks match.</p>}
    </>
  );
}

export const taskList = defineTool<State>({
  id: "tasks",
  title: "Task list",
  glyph: "☑",
  category: "Tasks",
  version: 1,
  stateSchema,
  defaultState: () => ({ query: "", status: "all", sort: "id" }),
  links: ["task"],
  component: TaskList,
  describe: (state, { links }) => ({
    selected: links.task ?? null,
    filter: state,
    note: "Sample task data. Change tasks with the task.create, task.update and task.delete commands.",
    tasks: select(store.getAll(), state).map(({ revision: _revision, notes: _notes, ...task }) => task),
  }),
});
