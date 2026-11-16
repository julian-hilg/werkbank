import { useLink, useToolState } from "@werkbank/framework";
import { geoCentroid, geoDistance, geoGraticule10, geoNaturalEarth1, geoOrthographic, geoPath, type GeoProjection } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import coarse from "world-atlas/countries-110m.json";
import { REVENUE_SHARE, SITES } from "../geo/data";
import { downloadCsv, downloadSvg, sequential, useBox } from "./lib";
import { CLASSES, classOf, type MapState } from "./map";

type Country = Feature<Geometry, { name: string }>;
const toCountries = (topology: unknown): Country[] =>
  (feature(topology as Topology, (topology as Topology).objects.countries!) as unknown as FeatureCollection<Geometry, { name: string }>).features;
const COARSE = toCountries(coarse);
const HQ = SITES[0]!;
const SPHERE = { type: "Sphere" } as const;
const GRATICULE = geoGraticule10();
const top = Object.entries(REVENUE_SHARE).sort((a, b) => b[1] - a[1]);

/** Finer coastlines, fetched the first time the view is close enough to need them. */
let finePromise: Promise<Country[]> | null = null;
const loadFine = () => (finePromise ??= import("world-atlas/countries-50m.json").then((m) => toCountries(m.default)));

const ease = (t: number) => 1 - (1 - t) ** 3;

export default function WorldMap() {
  const [state, setState] = useToolState<MapState>();
  const [country, setCountry] = useLink<string | null>("country");
  const [ref, box] = useBox<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  // While a gesture or an animation is running the view lives here; it is saved when it settles.
  const [live, setLive] = useState<Pick<MapState, "zoom" | "dx" | "dy" | "rotate"> | null>(null);
  const [fine, setFine] = useState<Country[] | null>(null);
  const drag = useRef<{ x: number; y: number; start: Pick<MapState, "zoom" | "dx" | "dy" | "rotate">; moved: boolean } | null>(null);
  const animation = useRef(0);
  const view = live ?? state;
  const globe = state.projection === "globe";
  const settled = live === null;

  const wantsFine = view.zoom >= 2.5 || (globe && view.zoom >= 1.8);
  useEffect(() => {
    if (wantsFine && !fine) void loadFine().then(setFine);
  }, [wantsFine, fine]);
  // Coarse outlines while moving keep the globe smooth; the fine ones appear when it stops.
  const countries = fine && wantsFine && (settled || !globe) ? fine : COARSE;

  const projection = useMemo<GeoProjection | null>(() => {
    if (!box.width || !box.height) return null;
    const extent: [[number, number], [number, number]] = [[10, 10], [box.width - 10, box.height - 10]];
    return globe ? geoOrthographic().fitExtent(extent, SPHERE).clipAngle(90) : geoNaturalEarth1().fitExtent(extent, SPHERE);
  }, [box.width, box.height, globe]);

  // The globe is re-projected as it turns; the flat map is projected once and moved with a transform.
  const shapes = useMemo(() => {
    if (!projection) return null;
    if (globe) {
      const base = projection.scale();
      projection.rotate([-view.rotate[0], -view.rotate[1]]).scale(base * view.zoom);
      const path = geoPath(projection);
      const result = build(path);
      projection.scale(base);
      return result;
    }
    return build(geoPath(projection));

    function build(path: ReturnType<typeof geoPath>) {
      return {
        sphere: path(SPHERE) ?? "",
        graticule: path(GRATICULE) ?? "",
        countries: countries.map((f) => ({ name: f.properties.name, d: path(f) ?? "" })).filter((c) => c.d),
        sites: SITES.map((s) => {
          const visible = !globe || geoDistance([s.lon, s.lat], [view.rotate[0], view.rotate[1]]) < Math.PI / 2;
          const point = projection!([s.lon, s.lat]);
          return { site: s, point: visible ? point : null };
        }),
        routes: SITES.slice(1).map((s) => ({ id: s.id, d: path({ type: "LineString", coordinates: [[HQ.lon, HQ.lat], [s.lon, s.lat]] }) ?? "" })),
      };
    }
  }, [projection, globe, countries, globe ? view.rotate[0] : 0, globe ? view.rotate[1] : 0, globe ? view.zoom : 1]);

  const commit = (next: Pick<MapState, "zoom" | "dx" | "dy" | "rotate">) => {
    setLive(null);
    setState({ ...state, zoom: Number(next.zoom.toFixed(3)), dx: Math.round(next.dx), dy: Math.round(next.dy), rotate: [Number(next.rotate[0].toFixed(1)), Number(next.rotate[1].toFixed(1))] });
  };
  /** Glide from the current view to another one, then save it. */
  const glide = (to: Pick<MapState, "zoom" | "dx" | "dy" | "rotate">, ms = 420) => {
    cancelAnimationFrame(animation.current);
    const from = { zoom: view.zoom, dx: view.dx, dy: view.dy, rotate: view.rotate };
    // Turn the short way round the globe.
    const turn = ((to.rotate[0] - from.rotate[0] + 540) % 360) - 180;
    const started = performance.now();
    const step = (now: number) => {
      const t = ease(Math.min(1, (now - started) / ms));
      const mix = (a: number, b: number) => a + (b - a) * t;
      const frame = { zoom: mix(from.zoom, to.zoom), dx: mix(from.dx, to.dx), dy: mix(from.dy, to.dy), rotate: [((from.rotate[0] + turn * t + 540) % 360) - 180, mix(from.rotate[1], to.rotate[1])] as [number, number] };
      if (t < 1) {
        setLive(frame);
        animation.current = requestAnimationFrame(step);
      } else commit(to);
    };
    animation.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(animation.current), []);

  const zoomBy = (factor: number) => {
    const zoom = Math.min(12, Math.max(1, view.zoom * factor));
    const k = zoom / view.zoom;
    glide({ zoom, dx: zoom === 1 ? 0 : view.dx * k, dy: zoom === 1 ? 0 : view.dy * k, rotate: view.rotate }, 260);
  };
  const onWheel = (e: WheelEvent) => {
    cancelAnimationFrame(animation.current);
    const rect = e.currentTarget.getBoundingClientRect();
    const [mx, my] = [e.clientX - rect.left - box.width / 2, e.clientY - rect.top - box.height / 2];
    const zoom = Math.min(12, Math.max(1, view.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    const k = zoom / view.zoom;
    // On the flat map the point under the pointer stays put; the globe zooms about its centre.
    commit(globe ? { ...view, zoom } : { zoom, dx: zoom === 1 ? 0 : mx - (mx - view.dx) * k, dy: zoom === 1 ? 0 : my - (my - view.dy) * k, rotate: view.rotate });
  };
  const onDown = (e: PointerEvent) => {
    cancelAnimationFrame(animation.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: { zoom: view.zoom, dx: view.dx, dy: view.dy, rotate: view.rotate }, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [mx, my] = [e.clientX - d.x, e.clientY - d.y];
    if (Math.abs(mx) + Math.abs(my) > 3) d.moved = true;
    if (!d.moved) return;
    if (globe) {
      const speed = 0.35 / view.zoom;
      setLive({ ...d.start, rotate: [((d.start.rotate[0] - mx * speed + 540) % 360) - 180, Math.min(90, Math.max(-90, d.start.rotate[1] + my * speed))] });
    } else setLive({ ...d.start, dx: d.start.dx + mx, dy: d.start.dy + my });
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) return void (live && commit(live));
    // A press without movement is a click. The pointer is captured for dragging, so the
    // click itself never reaches the country; look up what is under the pointer instead.
    const under = e.currentTarget.ownerDocument.elementFromPoint(e.clientX, e.clientY);
    const name = under?.closest("[data-country]")?.getAttribute("data-country");
    if (name) select(name);
  };
  const select = (name: string) => {
    const next = name === country ? null : name;
    setCountry(next);
    // On the globe, turn the chosen country to face the viewer.
    const target = next && globe ? COARSE.find((f) => f.properties.name === next) : null;
    if (target) {
      const [lon, lat] = geoCentroid(target);
      glide({ ...view, rotate: [lon, Math.max(-70, Math.min(70, lat))] }, 600);
    }
  };

  const showRevenue = state.layer !== "sites";
  const showSites = state.layer !== "revenue";
  const info = hover ?? country;
  const sitesHere = SITES.filter((s) => s.country === info);
  const rank = info ? top.findIndex(([name]) => name === info) + 1 : 0;
  const transform = globe ? undefined : `translate(${box.width / 2 + view.dx} ${box.height / 2 + view.dy}) scale(${view.zoom}) translate(${-box.width / 2} ${-box.height / 2})`;
  const unit = globe ? 1 : view.zoom; // sizes inside the flat map's transform are divided by the zoom
  const segment = <K extends "layer" | "projection">(key: K, options: readonly MapState[K][], label: (v: MapState[K]) => string, name: string) => (
    <span className="wb-segment" role="group" aria-label={name}>
      {options.map((option) => (
        <button key={option} className="wb-button" aria-pressed={state[key] === option} onClick={() => (cancelAnimationFrame(animation.current), setLive(null), setState({ ...state, [key]: option }))}>
          {label(option)}
        </button>
      ))}
    </span>
  );

  return (
    <div className="st-chart">
      <div className="wb-toolhead">
        <strong>World map</strong>
        <span className="wb-badge">sample data</span>
        <span className="st-grow" />
        {segment("projection", ["flat", "globe"] as const, (p) => (p === "flat" ? "Flat" : "Globe"), "Projection")}
        {segment("layer", ["revenue", "sites", "both"] as const, (l) => (l === "revenue" ? "Revenue" : l === "sites" ? "Sites" : "Both"), "Layer")}
        <label className="st-check">
          <input type="checkbox" checked={state.routes} disabled={!showSites} onChange={(e) => setState({ ...state, routes: e.target.checked })} />
          routes
        </label>
        <span className="wb-segment" role="group" aria-label="Zoom">
          <button className="wb-button" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out">
            −
          </button>
          <button className="wb-button" onClick={() => zoomBy(1.5)} aria-label="Zoom in">
            +
          </button>
          <button className="wb-button" onClick={() => glide({ zoom: 1, dx: 0, dy: 0, rotate: view.rotate })}>
            Fit
          </button>
        </span>
        <button className="wb-button" onClick={() => downloadCsv("revenue-by-country.csv", ["country", "revenue_share_pct"], top)}>
          CSV
        </button>
        <button className="wb-button" onClick={() => downloadSvg("map.svg", svg.current)}>
          SVG
        </button>
      </div>
      <div className="st-readout wb-num">
        {info
          ? `${info}   revenue share ${REVENUE_SHARE[info] !== undefined ? `${REVENUE_SHARE[info]}% (rank ${rank} of ${top.length})` : "none"}` +
            (sitesHere.length ? `   sites: ${sitesHere.map((s) => `${s.city}, ${s.role.toLowerCase()}, ${s.staff} staff`).join("; ")}` : "")
          : globe
            ? "Drag to turn the globe, scroll to zoom, click a country to bring it to the front."
            : "Scroll to zoom, drag to pan, click a country to select it."}
      </div>
      <div ref={ref} className="st-fill st-map">
        {shapes && (
          <svg
            ref={svg}
            width={box.width}
            height={box.height}
            className="st-grab"
            role="img"
            aria-label="World map of revenue share by country and office sites"
            onWheel={onWheel}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              {/* Lighter where the light falls, so the sphere reads as round. */}
              <radialGradient id="st-ocean" cx="38%" cy="32%" r="75%">
                <stop offset="0%" style={{ stopColor: "color-mix(in oklab, var(--wb-accent) 5%, var(--wb-canvas))" }} />
                <stop offset="100%" style={{ stopColor: "color-mix(in oklab, var(--wb-accent) 17%, var(--wb-canvas))" }} />
              </radialGradient>
            </defs>
            <g transform={transform}>
              <path d={shapes.sphere} fill="url(#st-ocean)" />
              <path d={shapes.graticule} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={0.5} style={{ stroke: "color-mix(in oklab, var(--wb-accent) 22%, var(--wb-canvas))" }} />
              {shapes.countries.map((c) => {
                const share = REVENUE_SHARE[c.name];
                const chosen = c.name === country;
                const hovered = c.name === hover;
                return (
                  <path
                    key={c.name}
                    d={c.d}
                    data-country={c.name}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    strokeWidth={chosen ? 2 : hovered ? 1.4 : 0.5}
                    style={{
                      fill: showRevenue && share !== undefined ? sequential(classOf(share).strength) : "color-mix(in oklab, var(--wb-text) 7%, var(--wb-canvas))",
                      stroke: chosen || hovered ? "var(--wb-text)" : "color-mix(in oklab, var(--wb-text) 28%, var(--wb-canvas))",
                      cursor: "pointer",
                    }}
                    onPointerEnter={() => setHover(c.name)}
                  />
                );
              })}
              <path d={shapes.sphere} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={1} style={{ stroke: "color-mix(in oklab, var(--wb-text) 35%, var(--wb-canvas))" }} />
              {showSites && state.routes &&
                shapes.routes.map((r) => (
                  <path key={r.id} d={r.d} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={1.25} strokeDasharray="4 3" strokeLinecap="round" style={{ stroke: "var(--wb-warn)", opacity: 0.8, pointerEvents: "none" }} />
                ))}
              {showSites &&
                shapes.sites.map(({ site, point }) => {
                  if (!point) return null;
                  const r = (4 + Math.sqrt(site.staff) * 0.5) / unit;
                  const labelled = globe || view.zoom >= 1.8 || site.staff >= 90;
                  return (
                    <g key={site.id} data-country={site.country} onPointerEnter={() => setHover(site.country)} style={{ cursor: "pointer" }}>
                      {site === HQ && <circle cx={point[0]} cy={point[1]} r={r + 4 / unit} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={1.5} style={{ stroke: "var(--wb-warn)" }} />}
                      <circle cx={point[0]} cy={point[1]} r={r} vectorEffect="non-scaling-stroke" strokeWidth={2} style={{ fill: "var(--wb-warn)", stroke: "var(--wb-canvas)" }} />
                      {labelled && (
                        <text x={point[0] + r + 4 / unit} y={point[1]} className="st-map-label" dominantBaseline="middle" style={{ fontSize: 11 / unit, strokeWidth: 3 / unit }}>
                          {site.city}
                        </text>
                      )}
                    </g>
                  );
                })}
            </g>
          </svg>
        )}
        {showRevenue && (
          <ul className="st-map-key" aria-label="Revenue share">
            {CLASSES.map((c) => (
              <li key={c.label}>
                <span className="st-swatch" style={{ background: sequential(c.strength) }} />
                {c.label}
              </li>
            ))}
            <li>
              <span className="st-swatch" style={{ background: "color-mix(in oklab, var(--wb-text) 7%, var(--wb-canvas))" }} />
              no revenue
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
