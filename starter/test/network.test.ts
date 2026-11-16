import { describe, expect, it } from "vitest";
import { correlationMatrix } from "../src/market/analytics";
import { SYMBOLS } from "../src/market/history";
import { buildNetwork, forceLayout, type LayoutEdge } from "../src/tools/network";

/** Two tight groups of four with nothing between them. */
const groups: LayoutEdge[] = [];
for (const base of [0, 4]) for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) groups.push({ a: base + i, b: base + j, weight: 0.85 });
const distance = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

describe("force layout", () => {
  it("is deterministic", () => {
    expect(forceLayout(8, groups)).toEqual(forceLayout(8, groups));
    expect(forceLayout(8, groups, { iterations: 50 })).toEqual(forceLayout(8, groups, { iterations: 50 }));
  });

  it("keeps every position within 0..1 and finite", () => {
    const cases: [number, LayoutEdge[]][] = [[8, groups], [8, []], [1, []], [2, [{ a: 0, b: 1, weight: 1 }]], [5, [{ a: 0, b: 9, weight: 0.5 }, { a: 1, b: 1, weight: 0.5 }]]];
    for (const [count, edges] of cases) {
      const points = forceLayout(count, edges);
      expect(points).toHaveLength(count);
      for (const p of points) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
    expect(forceLayout(0, [])).toEqual([]);
  });

  it("does not put two nodes on the same spot", () => {
    for (const edges of [groups, []]) {
      const points = forceLayout(8, edges);
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) expect(distance(points[i]!, points[j]!)).toBeGreaterThan(0.03);
    }
  });

  it("draws strongly correlated pairs closer together than unconnected ones", () => {
    const points = forceLayout(8, groups);
    const linked: number[] = [];
    const unlinked: number[] = [];
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) (i < 4 === j < 4 ? linked : unlinked).push(distance(points[i]!, points[j]!));
    expect(mean(linked)).toBeLessThan(mean(unlinked) * 0.6);
  });

  it("gives a stronger link a shorter length", () => {
    const length = (weight: number) => {
      const [p, q] = forceLayout(3, [{ a: 0, b: 1, weight }, { a: 1, b: 2, weight: 0.2 }]);
      const points = forceLayout(3, [{ a: 0, b: 1, weight }, { a: 1, b: 2, weight: 0.2 }]);
      return distance(p!, q!) / distance(points[1]!, points[2]!);
    };
    expect(length(0.9)).toBeLessThan(length(0.3));
  });

  it("does the same on the sample correlations", () => {
    const matrix = correlationMatrix();
    const network = buildNetwork(matrix, 0.3);
    const points = forceLayout(SYMBOLS.length, network.edges.map((e) => ({ a: SYMBOLS.indexOf(e.a), b: SYMBOLS.indexOf(e.b), weight: Math.abs(e.value) })));
    const linked: number[] = [];
    const unlinked: number[] = [];
    SYMBOLS.forEach((a, i) =>
      SYMBOLS.slice(i + 1).forEach((b, k) => {
        const j = i + 1 + k;
        (network.edges.some((e) => e.a === a && e.b === b) ? linked : unlinked).push(distance(points[i]!, points[j]!));
      }),
    );
    // Only meaningful when the sample has both kinds of pair at this threshold.
    if (linked.length && unlinked.length) expect(mean(linked)).toBeLessThan(mean(unlinked));
    expect(linked.length + unlinked.length).toBe(28);
  });
});

describe("correlation network", () => {
  const matrix = correlationMatrix({ method: "spearman" });

  it("links exactly the pairs at or above the threshold, once each", () => {
    for (const threshold of [0.1, 0.3, 0.8]) {
      const network = buildNetwork(matrix, threshold);
      let expected = 0;
      for (let i = 0; i < SYMBOLS.length; i++) for (let j = i + 1; j < SYMBOLS.length; j++) if (Math.abs(matrix[i]![j]!) >= threshold) expected++;
      expect(network.edges).toHaveLength(expected);
      for (const e of network.edges) {
        expect(e.value).toBe(matrix[SYMBOLS.indexOf(e.a)]![SYMBOLS.indexOf(e.b)]);
        expect(SYMBOLS.indexOf(e.a)).toBeLessThan(SYMBOLS.indexOf(e.b));
      }
    }
  });

  it("counts degrees and names the unconnected symbols", () => {
    const network = buildNetwork(matrix, 0.3);
    expect(network.nodes.reduce((s, n) => s + n.degree, 0)).toBe(network.edges.length * 2);
    expect(network.isolated).toEqual(network.nodes.filter((n) => n.degree === 0).map((n) => n.symbol));
    expect(buildNetwork(matrix, 1.01).isolated).toEqual([...SYMBOLS]);
    expect(buildNetwork(matrix, 0.8).edges.length).toBeLessThanOrEqual(buildNetwork(matrix, 0.1).edges.length);
  });
});
