import type { Command, Werkbank } from "@werkbank/framework";
import { z } from "zod";
import { taskFields, tasks, type Task } from "./store";

/**
 * Task commands. They change the app's own data, not the workspace, so each
 * declares how to undo itself. That keeps them in the "local" risk class:
 * an agent may run them without asking, because the person can reverse them
 * from the action history.
 */
export const taskCommands: Command<Werkbank, any>[] = [
  {
    id: "task.create",
    title: "Create task",
    category: "Tasks",
    risk: "local",
    input: taskFields.partial().required({ title: true }),
    run: (_ctx, fields: Partial<z.infer<typeof taskFields>> & { title: string }) =>
      tasks.create({ owner: "Ada", status: "todo", priority: "medium", due: null, estimateHours: null, blocked: false, tags: [], notes: "", ...fields }),
    undo: (_ctx, _input, created) => void tasks.remove((created as Task).id),
  },
  {
    id: "task.update",
    title: "Update task",
    category: "Tasks",
    risk: "local",
    input: z.object({ id: z.string(), patch: taskFields.partial() }),
    // Returns the task as it was before the change.
    run: (_ctx, i: { id: string; patch: Partial<z.infer<typeof taskFields>> }) => tasks.update(i.id, i.patch),
    undo: (_ctx, _input, before) => tasks.restore(before as Task),
  },
  {
    id: "task.delete",
    title: "Delete task",
    category: "Tasks",
    risk: "local",
    input: z.object({ id: z.string() }),
    run: (_ctx, i: { id: string }) => tasks.remove(i.id),
    undo: (_ctx, _input, removed) => {
      const { task, index } = removed as { task: Task; index: number };
      tasks.restore(task, index);
    },
  },
];
