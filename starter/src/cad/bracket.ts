import { z } from "zod";

/**
 * A parametric L-bracket: the example part for the CAD viewer. The geometry
 * and the derived quantities (volume, mass) are computed from six numbers.
 * Units are millimetres.
 */
export const paramsSchema = z.object({
  width: z.number().min(20).max(300),
  depth: z.number().min(20).max(200),
  height: z.number().min(20).max(200),
  thickness: z.number().min(2).max(20),
  holeDiameter: z.number().min(2).max(30),
  holes: z.number().int().min(1).max(6),
});
export type Params = z.infer<typeof paramsSchema>;

export const DEFAULT_PARAMS: Params = { width: 120, depth: 60, height: 80, thickness: 6, holeDiameter: 8, holes: 3 };

export type Vec = [number, number, number];
export interface Model {
  /** Straight edges and circles approximated by short segments. */
  lines: [Vec, Vec][];
  size: Vec;
  /** Problems that make the part impossible to manufacture as specified. */
  problems: string[];
}

const circle = (centre: Vec, radius: number, plane: "xy" | "xz", segments = 28): [Vec, Vec][] => {
  const point = (k: number): Vec => {
    const a = (k / segments) * Math.PI * 2;
    const [c, s] = [Math.cos(a) * radius, Math.sin(a) * radius];
    return plane === "xy" ? [centre[0] + c, centre[1] + s, centre[2]] : [centre[0] + c, centre[1], centre[2] + s];
  };
  return Array.from({ length: segments }, (_, k) => [point(k), point(k + 1)] as [Vec, Vec]);
};

export function build(p: Params): Model {
  const { width: w, depth: d, height: h, thickness: t, holeDiameter, holes } = p;
  const r = holeDiameter / 2;
  // The L-shaped profile in the y-z plane, extruded along x.
  const profile: [number, number][] = [[0, 0], [d, 0], [d, t], [t, t], [t, h], [0, h]];
  const lines: [Vec, Vec][] = [];
  profile.forEach(([y, z], i) => {
    const [y2, z2] = profile[(i + 1) % profile.length]!;
    lines.push([[0, y, z], [0, y2, z2]], [[w, y, z], [w, y2, z2]], [[0, y, z], [w, y, z]]);
  });
  // Holes through the base plate and through the upright, evenly spaced along the width.
  const xs = Array.from({ length: holes }, (_, i) => (w * (i + 1)) / (holes + 1));
  const baseY = (d + t) / 2;
  const uprightZ = (h + t) / 2;
  for (const x of xs) {
    lines.push(...circle([x, baseY, 0], r, "xy"), ...circle([x, baseY, t], r, "xy"));
    lines.push(...circle([x, 0, uprightZ], r, "xz"), ...circle([x, t, uprightZ], r, "xz"));
  }
  const problems: string[] = [];
  const pitch = w / (holes + 1);
  if (holeDiameter >= pitch) problems.push(`Holes overlap: ${holes} holes of ${holeDiameter} mm need more than ${w} mm of width.`);
  if (holeDiameter + 2 * t > d - t) problems.push("The base is too shallow for the hole diameter plus an edge margin of one thickness.");
  if (holeDiameter + 2 * t > h - t) problems.push("The upright is too short for the hole diameter plus an edge margin of one thickness.");
  if (t * 2 >= Math.min(d, h)) problems.push("The plate is too thick for the bracket's size.");
  return { lines, size: [w, d, h], problems };
}

/** Steel, grams per cubic millimetre. */
const DENSITY = 0.00785;

export function properties(p: Params) {
  const profileArea = p.depth * p.thickness + (p.height - p.thickness) * p.thickness;
  const holeVolume = 2 * p.holes * Math.PI * (p.holeDiameter / 2) ** 2 * p.thickness;
  const volume = profileArea * p.width - holeVolume;
  return { volumeMm3: volume, massGrams: volume * DENSITY, holePitchMm: p.width / (p.holes + 1) };
}
