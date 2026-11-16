import { z } from "zod";

/**
 * A small task tracker: the non-trading example. Like the ledger, it is a
 * plain store outside the panels. The schema below is the single definition
 * of a valid task; the form, the commands and storage all use it.
 */
export const STATUSES = ["todo", "doing", "review", "done"] as const;
export const STATUS_LABEL: Record<Status, string> = { todo: "To do", doing: "In progress", review: "In review", done: "Done" };
export const PRIORITIES = ["low", "medium", "high"] as const;
export const OWNERS = ["Ada", "Ben", "Chen", "Dana"] as const;
export type Status = (typeof STATUSES)[number];

export const taskFields = z.object({
  title: z.string().trim().min(3, "Give the task a title of at least 3 characters.").max(80, "Keep the title under 80 characters."),
  owner: z.enum(OWNERS, "Choose an owner."),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.")
    .nullable(),
  estimateHours: z.number("Enter a number of hours.").min(0.5, "At least half an hour.").max(200, "At most 200 hours.").nullable(),
  blocked: z.boolean(),
  tags: z.array(z.string().trim().min(1).max(20)).max(6, "At most 6 tags."),
  notes: z.string().max(2000, "Keep notes under 2000 characters."),
});
export type TaskFields = z.infer<typeof taskFields>;

/** A rule across fields: a blocked task needs a note saying why. */
export const taskSchema = taskFields.refine((t) => !t.blocked || t.notes.trim().length > 0, {
  path: ["notes"],
  message: "Say what the task is blocked on.",
});

export interface Task extends TaskFields {
  id: string;
  /** Increases on every save, so a form can tell its copy is out of date. */
  revision: number;
}

export const blankTask = (): TaskFields => ({
  title: "", owner: "Ada", status: "todo", priority: "medium", due: null, estimateHours: null, blocked: false, tags: [], notes: "",
});

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const seed = (): Task[] =>
  (
    [
      ["Draft data-source register", "Ada", "done", "medium", -6, 4, false, ["data"], ""],
      ["Write ingestion contract for filings", "Ben", "review", "high", -1, 8, false, ["data", "pipeline"], ""],
      ["Backfill 2019–2021 history", "Chen", "doing", "high", 2, 16, false, ["pipeline"], ""],
      ["Reconcile vendor totals with ledger", "Dana", "doing", "medium", 4, 6, true, ["quality"], "Waiting for the vendor's corrected file."],
      ["Review outlier rules", "Ada", "todo", "low", 9, 3, false, ["quality"], ""],
      ["Set up nightly validation run", "Ben", "todo", "medium", 12, 5, false, ["pipeline", "ops"], ""],
      ["Document retention policy", "Dana", "todo", "low", null, null, false, ["docs"], ""],
      ["Prepare findings note", "Chen", "todo", "high", 15, 10, false, ["docs"], ""],
    ] as const
  ).map(([title, owner, status, priority, due, estimateHours, blocked, tags, notes], i) => ({
    id: `T-${101 + i}`, revision: 1, title, owner, status, priority, due: due === null ? null : day(due), estimateHours, blocked, tags: [...tags], notes,
  }));

type Listener = () => void;
const KEY = "starter.tasks";

export class TaskStore {
  private tasks: Task[];
  private listeners = new Set<Listener>();

  constructor(private storage: Pick<Storage, "getItem" | "setItem"> | null) {
    this.tasks = this.load() ?? seed();
  }

  getAll = (): Task[] => this.tasks;
  get = (id: string): Task | undefined => this.tasks.find((t) => t.id === id);
  subscribe = (fn: Listener) => (this.listeners.add(fn), () => void this.listeners.delete(fn));

  create(fields: TaskFields): Task {
    const numbers = this.tasks.map((t) => Number(t.id.slice(2))).filter(Number.isFinite);
    const task: Task = { ...taskSchema.parse(fields), id: `T-${Math.max(100, ...numbers) + 1}`, revision: 1 };
    this.commit([...this.tasks, task]);
    return task;
  }

  /** Apply a partial change. Returns the task as it was, so the change can be undone. */
  update(id: string, patch: Partial<TaskFields>): Task {
    const before = this.get(id);
    if (!before) throw new Error(`Unknown task: ${id}`);
    const { id: _id, revision, ...current } = before;
    const next: Task = { ...taskSchema.parse({ ...current, ...patch }), id, revision: revision + 1 };
    this.commit(this.tasks.map((t) => (t.id === id ? next : t)));
    return before;
  }

  /** Returns the removed task and where it was, so it can be put back. */
  remove(id: string): { task: Task; index: number } {
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index < 0) throw new Error(`Unknown task: ${id}`);
    const task = this.tasks[index]!;
    this.commit(this.tasks.filter((t) => t.id !== id));
    return { task, index };
  }

  /** Put a task back exactly as given (used by undo). */
  restore(task: Task, index?: number): void {
    const others = this.tasks.filter((t) => t.id !== task.id);
    const at = index ?? this.tasks.findIndex((t) => t.id === task.id);
    others.splice(at < 0 ? others.length : at, 0, { ...task, revision: (this.get(task.id)?.revision ?? task.revision) + 1 });
    this.commit(others);
  }

  private commit(tasks: Task[]): void {
    this.tasks = tasks;
    try {
      this.storage?.setItem(KEY, JSON.stringify(tasks));
    } catch {
      /* the tasks then last for this page load only */
    }
    this.listeners.forEach((fn) => fn());
  }

  private load(): Task[] | null {
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) ?? "null");
      if (!Array.isArray(raw)) return null;
      const stored = z.array(taskFields.extend({ id: z.string(), revision: z.number() })).safeParse(raw);
      return stored.success ? stored.data : null;
    } catch {
      return null;
    }
  }
}

export const tasks = new TaskStore(typeof localStorage === "undefined" ? null : localStorage);
