import { afterEach, describe, expect, it, vi } from "vitest";
import { FAIL_EVERY, FLAKY_JOB, JOBS } from "../src/pipeline/data";
import { layersOf, layoutPipeline, orderLayers, reachable, runOrder } from "../src/pipeline/layout";
import { PipelineStore, countByStatus } from "../src/pipeline/store";

const edges = JOBS.flatMap((j) => j.upstream.map((from) => ({ from, to: j.id })));

describe("pipeline layout", () => {
  it("puts every job in a later layer than all of its upstream jobs", () => {
    const layer = layersOf(JOBS);
    expect(layer.size).toBe(JOBS.length);
    for (const e of edges) expect(layer.get(e.to)!).toBeGreaterThan(layer.get(e.from)!);
    for (const job of JOBS) expect(layer.get(job.id)).toBe(job.upstream.length ? Math.max(...job.upstream.map((u) => layer.get(u)!)) + 1 : 0);
  });

  it("keeps every job exactly once when ordering the layers", () => {
    expect(orderLayers(JOBS).flat().sort()).toEqual(JOBS.map((j) => j.id).sort());
  });

  it.each(["lr", "tb"] as const)("gives every node its own place without overlap (%s)", (orientation) => {
    const layout = layoutPipeline(JOBS, orientation);
    expect(layout.nodes).toHaveLength(JOBS.length);
    expect(new Set(layout.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(JOBS.length);
    for (const a of layout.nodes) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + layout.nodeWidth).toBeLessThanOrEqual(layout.width);
      expect(a.y + layout.nodeHeight).toBeLessThanOrEqual(layout.height);
      for (const b of layout.nodes) {
        if (a === b) continue;
        const apart = Math.abs(a.x - b.x) >= layout.nodeWidth || Math.abs(a.y - b.y) >= layout.nodeHeight;
        expect(apart).toBe(true);
      }
    }
  });

  it("advances along the main axis with the layer", () => {
    const at = (orientation: "lr" | "tb") => new Map(layoutPipeline(JOBS, orientation).nodes.map((n) => [n.id, n]));
    const [lr, tb] = [at("lr"), at("tb")];
    for (const e of edges) {
      expect(lr.get(e.to)!.x).toBeGreaterThan(lr.get(e.from)!.x);
      expect(tb.get(e.to)!.y).toBeGreaterThan(tb.get(e.from)!.y);
    }
  });

  it("does not cross edges that a barycentre pass can untangle", () => {
    // a→d and b→c cross in the given order; ordering the second layer by its parents uncrosses them.
    const rows = orderLayers([
      { id: "a", upstream: [] },
      { id: "b", upstream: [] },
      { id: "c", upstream: ["b"] },
      { id: "d", upstream: ["a"] },
    ]);
    expect(rows[0]!.indexOf("a") < rows[0]!.indexOf("b")).toBe(rows[1]!.indexOf("d") < rows[1]!.indexOf("c"));
  });
});

describe("pipeline graph", () => {
  it("runs jobs in a valid topological order", () => {
    const order = runOrder(JOBS);
    expect([...order].sort()).toEqual(JOBS.map((j) => j.id).sort());
    for (const e of edges) expect(order.indexOf(e.from)).toBeLessThan(order.indexOf(e.to));
  });

  it("refuses a cycle", () => {
    expect(() => runOrder([{ id: "a", upstream: ["b"] }, { id: "b", upstream: ["a"] }])).toThrow();
  });

  it("finds everything upstream and downstream of a job", () => {
    expect([...reachable(JOBS, "check-gaps", "upstream")].sort()).toEqual(["clean-prices", "src-calendar", "src-prices"]);
    expect([...reachable(JOBS, FLAKY_JOB, "downstream")].sort()).toEqual(["risk-report", "warehouse-export"]);
  });
});

describe("pipeline store", () => {
  afterEach(() => vi.useRealTimers());

  it("runs every job to ok, never starting one before its inputs are ok", () => {
    vi.useFakeTimers();
    const store = new PipelineStore(JOBS, () => 100);
    const started: string[] = [];
    store.subscribe(() => {
      for (const job of JOBS) {
        if (store.statusOf(job.id) !== "running" || started.includes(job.id)) continue;
        started.push(job.id);
        expect(job.upstream.every((u) => store.statusOf(u) === "ok")).toBe(true);
      }
    });
    store.run();
    expect(store.isRunning()).toBe(true);
    expect(JOBS.filter((j) => j.upstream.length).every((j) => store.statusOf(j.id) === "waiting")).toBe(true);
    vi.runAllTimers();
    expect(store.isRunning()).toBe(false);
    expect(countByStatus(store.getState()).ok).toBe(JOBS.length);
    expect([...started].sort()).toEqual(JOBS.map((j) => j.id).sort());
  });

  it("fails the designated check on every third run and leaves its downstream stale", () => {
    vi.useFakeTimers();
    const store = new PipelineStore(JOBS, () => 10);
    for (let run = 1; run <= FAIL_EVERY * 2; run++) {
      store.run();
      vi.runAllTimers();
      const failed = run % FAIL_EVERY === 0;
      expect(store.statusOf(FLAKY_JOB)).toBe(failed ? "failed" : "ok");
      expect(store.statusOf("risk-report")).toBe(failed ? "stale" : "ok");
      expect(store.statusOf("warehouse-export")).toBe(failed ? "stale" : "ok");
      expect(store.statusOf("join-factors")).toBe("ok");
      expect(store.isRunning()).toBe(false);
    }
  });

  it("resets to the sample and restores a state for undo, continuing a run that was under way", () => {
    vi.useFakeTimers();
    const store = new PipelineStore(JOBS, () => 10);
    const sample = store.getState();
    const before = store.run();
    expect(before).toBe(sample);
    vi.advanceTimersByTime(15);
    const midRun = store.reset();
    expect(store.getState().statuses).toEqual(sample.statuses);
    expect(store.getState().runs).toBe(0);
    vi.runAllTimers();
    expect(store.getState().statuses).toEqual(sample.statuses);
    store.restore(midRun);
    expect(store.isRunning()).toBe(true);
    vi.runAllTimers();
    expect(countByStatus(store.getState()).ok).toBe(JOBS.length);
    store.restore(sample);
    expect(store.getState()).toBe(sample);
  });
});
