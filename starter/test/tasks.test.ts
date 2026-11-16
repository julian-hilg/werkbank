import { describe, expect, it } from "vitest";
import { TaskStore, blankTask, taskSchema } from "../src/tasks/store";

describe("task validation", () => {
  it("accepts a complete task and reports each problem by field", () => {
    expect(taskSchema.safeParse({ ...blankTask(), title: "Write the report" }).success).toBe(true);
    const bad = taskSchema.safeParse({ ...blankTask(), title: "x", estimateHours: 0, due: "soon" });
    expect(bad.success).toBe(false);
    const fields = bad.error!.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["title", "estimateHours", "due"]));
  });

  it("requires a note on a blocked task", () => {
    const blocked = taskSchema.safeParse({ ...blankTask(), title: "Wait for data", blocked: true });
    expect(blocked.error!.issues[0]).toMatchObject({ path: ["notes"], message: "Say what the task is blocked on." });
    expect(taskSchema.safeParse({ ...blankTask(), title: "Wait for data", blocked: true, notes: "Vendor file" }).success).toBe(true);
  });
});

describe("task store", () => {
  it("creates with the next id, updates with a new revision, and rejects invalid changes", () => {
    const store = new TaskStore(null);
    const created = store.create({ ...blankTask(), title: "New thing" });
    expect(created.id).toBe("T-109");
    const before = store.update(created.id, { status: "doing" });
    expect(before.status).toBe("todo");
    expect(store.get(created.id)).toMatchObject({ status: "doing", revision: 2 });
    expect(() => store.update(created.id, { title: "" })).toThrow();
    expect(store.get(created.id)!.title).toBe("New thing");
  });

  it("puts a removed task back where it was", () => {
    const store = new TaskStore(null);
    const ids = store.getAll().map((t) => t.id);
    const removed = store.remove("T-103");
    expect(store.get("T-103")).toBeUndefined();
    store.restore(removed.task, removed.index);
    expect(store.getAll().map((t) => t.id)).toEqual(ids);
  });
});
