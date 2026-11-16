/** Pure graph helpers for the pipeline: layering, ordering, positions and run order. */

export interface GraphJob {
  id: string;
  upstream: string[];
}
export type Orientation = "lr" | "tb";

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  /** Gap between layers. */
  layerGap?: number;
  /** Gap between nodes of one layer. */
  nodeGap?: number;
  pad?: number;
}
export interface PlacedNode {
  id: string;
  layer: number;
  /** Position within the layer, from 0. */
  order: number;
  /** Top-left corner. */
  x: number;
  y: number;
}
export interface PipelineLayout {
  nodes: PlacedNode[];
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
  layerCount: number;
}

/** Upstream ids that exist in the graph (an unknown id is ignored, not an error). */
const known = (jobs: GraphJob[]) => {
  const ids = new Set(jobs.map((j) => j.id));
  return new Map(jobs.map((j) => [j.id, j.upstream.filter((u) => ids.has(u) && u !== j.id)]));
};

/**
 * A topological order: every job comes after all of its upstream jobs. Among
 * jobs that are ready at the same time the given order is kept. Throws on a cycle.
 */
export function runOrder(jobs: GraphJob[]): string[] {
  const upstream = known(jobs);
  const done = new Set<string>();
  const order: string[] = [];
  while (order.length < jobs.length) {
    const ready = jobs.filter((j) => !done.has(j.id) && upstream.get(j.id)!.every((u) => done.has(u)));
    if (!ready.length) throw new Error("The pipeline has a cycle.");
    for (const job of ready) {
      done.add(job.id);
      order.push(job.id);
    }
  }
  return order;
}

/** Layer of each job: the length of the longest path from any source. */
export function layersOf(jobs: GraphJob[]): Map<string, number> {
  const upstream = known(jobs);
  const layer = new Map<string, number>();
  for (const id of runOrder(jobs)) layer.set(id, Math.max(-1, ...upstream.get(id)!.map((u) => layer.get(u)!)) + 1);
  return layer;
}

/** Every job reachable against the edges (`upstream`) or along them (`downstream`), excluding the job itself. */
export function reachable(jobs: GraphJob[], id: string, direction: "upstream" | "downstream"): Set<string> {
  const upstream = known(jobs);
  const next = (at: string) => (direction === "upstream" ? (upstream.get(at) ?? []) : jobs.filter((j) => upstream.get(j.id)!.includes(at)).map((j) => j.id));
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    for (const n of next(queue.pop()!)) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

export const directDownstream = (jobs: GraphJob[], id: string): string[] => jobs.filter((j) => j.upstream.includes(id)).map((j) => j.id);

/** Order within each layer, after a few barycentre sweeps to reduce edge crossings. */
export function orderLayers(jobs: GraphJob[]): string[][] {
  const upstream = known(jobs);
  const layer = layersOf(jobs);
  const rows: string[][] = [];
  for (const job of jobs) (rows[layer.get(job.id)!] ??= []).push(job.id);
  const downstream = new Map(jobs.map((j) => [j.id, [] as string[]]));
  for (const job of jobs) for (const u of upstream.get(job.id)!) downstream.get(u)!.push(job.id);

  // A node's place is its index divided by the layer size, so layers of different sizes compare.
  const place = new Map<string, number>();
  const index = () => rows.forEach((row) => row.forEach((id, i) => place.set(id, (i + 0.5) / row.length)));
  const sweep = (row: string[], neighbours: Map<string, string[]>) => {
    const centre = new Map(
      row.map((id) => {
        const ns = neighbours.get(id)!;
        return [id, ns.length ? ns.reduce((s, n) => s + place.get(n)!, 0) / ns.length : place.get(id)!];
      }),
    );
    // Array.prototype.sort is stable, so ties keep their order.
    row.sort((a, b) => centre.get(a)! - centre.get(b)!);
  };
  index();
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < rows.length; i++) (sweep(rows[i]!, upstream), index());
    for (let i = rows.length - 2; i >= 0; i--) (sweep(rows[i]!, downstream), index());
  }
  return rows;
}

/**
 * Positions for every job. Layers advance left to right ("lr") or top to
 * bottom ("tb"); each layer is centred on the cross axis.
 */
export function layoutPipeline(jobs: GraphJob[], orientation: Orientation, options: LayoutOptions = {}): PipelineLayout {
  const { nodeWidth = 136, nodeHeight = 50, pad = 12 } = options;
  const layerGap = options.layerGap ?? (orientation === "lr" ? 36 : 34);
  const nodeGap = options.nodeGap ?? (orientation === "lr" ? 14 : 18);
  const rows = orderLayers(jobs);
  const widest = Math.max(0, ...rows.map((r) => r.length));
  // Size of a node along the layer axis and across it.
  const [along, across] = orientation === "lr" ? [nodeWidth, nodeHeight] : [nodeHeight, nodeWidth];
  const crossSize = widest * across + Math.max(0, widest - 1) * nodeGap;
  const mainSize = rows.length * along + Math.max(0, rows.length - 1) * layerGap;
  const nodes: PlacedNode[] = [];
  rows.forEach((row, layer) => {
    const rowSize = row.length * across + (row.length - 1) * nodeGap;
    row.forEach((id, order) => {
      const main = pad + layer * (along + layerGap);
      const cross = pad + (crossSize - rowSize) / 2 + order * (across + nodeGap);
      nodes.push({ id, layer, order, x: orientation === "lr" ? main : cross, y: orientation === "lr" ? cross : main });
    });
  });
  const [width, height] = orientation === "lr" ? [mainSize, crossSize] : [crossSize, mainSize];
  return { nodes, width: width + 2 * pad, height: height + 2 * pad, nodeWidth, nodeHeight, layerCount: rows.length };
}
