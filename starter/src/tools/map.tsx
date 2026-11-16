import { defineTool } from "@werkbank/framework";
import { lazy } from "react";
import { z } from "zod";
import { REVENUE_SHARE, SITES } from "../geo/data";

/**
 * The map's definition. Its view, the projection library and the country
 * outlines are loaded only when a map panel is first shown.
 */
export const mapStateSchema = z.object({
  layer: z.enum(["revenue", "sites", "both"]),
  projection: z.enum(["flat", "globe"]),
  /** Flat map: zoom factor and the centre offset in pixels at zoom 1. */
  zoom: z.number().min(1).max(12),
  dx: z.number(),
  dy: z.number(),
  /** Globe: the longitude and latitude facing the viewer. */
  rotate: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  routes: z.boolean(),
});
export type MapState = z.infer<typeof mapStateSchema>;

/** Revenue classes: a few clear steps read better on a map than a continuous ramp. */
export const CLASSES = [
  { from: 10, label: "10% and over", strength: 1 },
  { from: 5, label: "5 to 10%", strength: 0.76 },
  { from: 2, label: "2 to 5%", strength: 0.54 },
  { from: 1, label: "1 to 2%", strength: 0.34 },
  { from: 0, label: "under 1%", strength: 0.16 },
] as const;
export const classOf = (share: number) => CLASSES.find((c) => share >= c.from)!;

export const mapTool = defineTool<MapState>({
  id: "map",
  title: "World map",
  glyph: "◍",
  category: "Showcase",
  version: 2,
  stateSchema: mapStateSchema,
  defaultState: () => ({ layer: "both", projection: "flat", zoom: 1, dx: 0, dy: 0, rotate: [-10, 25], routes: true }),
  // Version 1 was a flat map only.
  migrate: (state) => ({ projection: "flat", rotate: [-10, 25], routes: true, layer: "both", zoom: 1, dx: 0, dy: 0, ...(state as object) }),
  links: ["country"],
  component: lazy(() => import("./map.view")),
  describe: (state, { links }) => ({
    selectedCountry: links.country ?? null,
    layer: state.layer,
    projection: state.projection,
    view: state.projection === "flat" ? { zoom: state.zoom } : { facingLongitude: state.rotate[0], facingLatitude: state.rotate[1] },
    note: "Country outlines are real; revenue shares and staff numbers are invented sample data. Select a country with link.publish (topic: country).",
    revenueSharePct: REVENUE_SHARE,
    revenueClasses: CLASSES.map((c) => c.label),
    sites: SITES.map(({ city, country, staff, role }) => ({ city, country, staff, role })),
  }),
});
