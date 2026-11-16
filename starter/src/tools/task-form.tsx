import { Select, defineTool, useLink, useToolState, useWerkbank } from "@werkbank/framework";
import { useState } from "react";
import { z } from "zod";
import { useTask } from "../tasks/hooks";
import { OWNERS, PRIORITIES, STATUSES, STATUS_LABEL, taskSchema, tasks as store, type Task, type TaskFields } from "../tasks/store";

/**
 * What the person has typed, as typed. Numbers and dates stay strings until
 * they are checked, so a half-finished entry is never lost or coerced.
 */
const valuesSchema = z.object({
  title: z.string(), owner: z.string(), status: z.string(), priority: z.string(), due: z.string(),
  estimateHours: z.string(), blocked: z.boolean(), tags: z.string(), notes: z.string(),
});
type Values = z.infer<typeof valuesSchema>;

/** Unsaved edits per task, with the revision they started from. They survive reloads and moving the panel. */
const stateSchema = z.object({ drafts: z.record(z.string(), z.object({ base: z.number(), values: valuesSchema })) });
type State = z.infer<typeof stateSchema>;

const toValues = (t: Task): Values => ({
  title: t.title, owner: t.owner, status: t.status, priority: t.priority, due: t.due ?? "",
  estimateHours: t.estimateHours === null ? "" : String(t.estimateHours), blocked: t.blocked, tags: t.tags.join(", "), notes: t.notes,
});

/** Turn what was typed into a task, or into one message per field that is wrong. */
function check(values: Values): { ok: true; fields: TaskFields } | { ok: false; errors: Partial<Record<keyof Values, string>> } {
  const result = taskSchema.safeParse({
    ...values,
    due: values.due || null,
    estimateHours: values.estimateHours.trim() === "" ? null : Number(values.estimateHours),
    tags: values.tags.split(",").map((t) => t.trim()).filter(Boolean),
  });
  if (result.success) return { ok: true, fields: result.data };
  const errors: Partial<Record<keyof Values, string>> = {};
  for (const issue of result.error.issues) errors[issue.path[0] as keyof Values] ??= issue.message;
  return { ok: false, errors };
}

function TaskForm() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const [taskId, setTaskId] = useLink<string | null>("task");
  const task = useTask(taskId);
  const [message, setMessage] = useState<string | null>(null);

  if (!task) return <p className="st-blank">{taskId ? `Task ${taskId} no longer exists.` : "Select a task in a task list or on the board."}</p>;

  const draft = state.drafts[task.id];
  const values = draft?.values ?? toValues(task);
  const dirty = Boolean(draft);
  const checked = check(values);
  const errors = dirty && !checked.ok ? checked.errors : {};
  const stale = draft !== undefined && draft.base !== task.revision;
  const others = Object.keys(state.drafts).filter((id) => id !== task.id);

  const edit = (patch: Partial<Values>) => {
    setMessage(null);
    setState({ drafts: { ...state.drafts, [task.id]: { base: draft?.base ?? task.revision, values: { ...values, ...patch } } } });
  };
  const discard = (id = task.id) => {
    const { [id]: _dropped, ...drafts } = state.drafts;
    setState({ drafts });
  };
  const save = async () => {
    if (!checked.ok) return;
    const result = await wb.run("task.update", { id: task.id, patch: checked.fields });
    if (result.ok) discard();
    setMessage(result.ok ? "Saved." : result.error);
  };
  const remove = async () => {
    const result = await wb.run("task.delete", { id: task.id });
    if (result.ok) (discard(), setTaskId(null));
    else setMessage(result.error);
  };

  const uid = `task-${task.id}`;
  const control = (name: keyof Values, label: string, input: React.ReactNode) => (
    <div className="wb-control" data-invalid={errors[name] ? true : undefined}>
      <label htmlFor={`${uid}-${name}`}>{label}</label>
      {input}
      {errors[name] && (
        <span className="wb-control-error" id={`${uid}-${name}-error`} role="alert">
          {errors[name]}
        </span>
      )}
    </div>
  );
  const common = (name: keyof Values) => ({
    id: `${uid}-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${uid}-${name}-error` : undefined,
  });

  return (
    <form
      className="wb-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="wb-form-actions">
        <strong>{task.id}</strong>
        {dirty ? <span className="wb-badge" data-tone="warn">unsaved changes</span> : <span className="wb-badge">saved</span>}
        {message && <span className="wb-hint" role="status">{message}</span>}
      </div>
      {stale && (
        <p className="wb-hint wb-warn" role="alert">
          This task was changed elsewhere after you started editing. Saving will overwrite those changes.
        </p>
      )}

      {control("title", "Title", <input className="wb-input" {...common("title")} value={values.title} onChange={(e) => edit({ title: e.target.value })} />)}

      <div className="wb-form-row">
        {control(
          "owner",
          "Owner",
          <Select {...common("owner")} value={values.owner} options={OWNERS.map((o) => ({ value: o, label: o }))} onChange={(owner) => edit({ owner })} />,
        )}
        {control(
          "status",
          "Status",
          <Select {...common("status")} value={values.status} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} onChange={(status) => edit({ status })} />,
        )}
      </div>

      <fieldset className="wb-control">
        <legend>Priority</legend>
        <div>
          {PRIORITIES.map((p) => (
            <label key={p} className="wb-choice">
              <input type="radio" name={`${uid}-priority`} checked={values.priority === p} onChange={() => edit({ priority: p })} />
              {p}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="wb-form-row">
        {control("due", "Due date", <input className="wb-input" type="date" {...common("due")} value={values.due} onChange={(e) => edit({ due: e.target.value })} />)}
        {control(
          "estimateHours",
          "Estimate (hours)",
          <input className="wb-input wb-num" inputMode="decimal" {...common("estimateHours")} value={values.estimateHours} onChange={(e) => edit({ estimateHours: e.target.value })} />,
        )}
      </div>

      {control("tags", "Tags (comma-separated)", <input className="wb-input" {...common("tags")} value={values.tags} onChange={(e) => edit({ tags: e.target.value })} />)}

      <label className="wb-choice">
        <input type="checkbox" checked={values.blocked} onChange={(e) => edit({ blocked: e.target.checked })} />
        Blocked
      </label>

      {control("notes", "Notes", <textarea className="wb-input" rows={4} {...common("notes")} value={values.notes} onChange={(e) => edit({ notes: e.target.value })} />)}

      <div className="wb-form-actions">
        <button className="wb-button" type="submit" disabled={!dirty || !checked.ok}>
          Save
        </button>
        <button className="wb-button" type="button" disabled={!dirty} onClick={() => discard()}>
          Discard changes
        </button>
        <span style={{ flex: 1 }} />
        <button className="wb-button" type="button" onClick={() => void remove()}>
          Delete task
        </button>
      </div>
      {others.length > 0 && (
        <p className="wb-hint">
          Unsaved changes also in{" "}
          {others.map((id) => (
            <button key={id} type="button" className="st-linkish" onClick={() => setTaskId(id)}>
              {id}
            </button>
          ))}
        </p>
      )}
    </form>
  );
}

export const taskForm = defineTool<State>({
  id: "task-form",
  title: "Task form",
  glyph: "✎",
  category: "Tasks",
  version: 1,
  stateSchema,
  defaultState: () => ({ drafts: {} }),
  links: ["task"],
  component: TaskForm,
  describe: (state, { links }) => {
    const id = typeof links.task === "string" ? links.task : null;
    const task = id ? store.get(id) : undefined;
    const draft = id ? state.drafts[id] : undefined;
    const checked = draft ? check(draft.values) : null;
    return {
      task: task ?? null,
      unsavedDraft: draft?.values ?? null,
      draftErrors: checked && !checked.ok ? checked.errors : null,
      otherUnsavedDrafts: Object.keys(state.drafts).filter((d) => d !== id),
      note: "The draft is what the user has typed but not saved. Save with the task.update command.",
    };
  },
});
