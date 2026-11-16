import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, build, properties } from "../src/cad/bracket";

describe("parametric bracket", () => {
  it("derives volume and mass from the dimensions", () => {
    const p = { ...DEFAULT_PARAMS, holes: 1, holeDiameter: 10 };
    const solid = (p.depth * p.thickness + (p.height - p.thickness) * p.thickness) * p.width;
    const holes = 2 * Math.PI * 25 * p.thickness;
    expect(properties(p).volumeMm3).toBeCloseTo(solid - holes);
    expect(properties(p).massGrams).toBeCloseTo((solid - holes) * 0.00785);
  });

  it("has more lines with more holes, and stays inside its bounding size", () => {
    const few = build({ ...DEFAULT_PARAMS, holes: 1 });
    const many = build({ ...DEFAULT_PARAMS, holes: 4 });
    expect(many.lines.length).toBeGreaterThan(few.lines.length);
    for (const [a, b] of many.lines) for (const v of [a, b]) v.forEach((c, i) => (expect(c).toBeGreaterThanOrEqual(-1e-9), expect(c).toBeLessThanOrEqual(many.size[i]! + 1e-9)));
  });

  it("flags a part that cannot be made", () => {
    expect(build(DEFAULT_PARAMS).problems).toEqual([]);
    expect(build({ ...DEFAULT_PARAMS, holes: 6, holeDiameter: 30 }).problems.join(" ")).toMatch(/overlap/);
  });
});
