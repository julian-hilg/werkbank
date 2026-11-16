/** Helpers shared by the example tools: exports and colour scales. */

// ---- exports ------------------------------------------------------------------

function save(name: string, blob: Blob, doc: Document = document): void {
  const link = doc.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export const downloadText = (name: string, text: string, mime = "text/plain") => save(name, new Blob([text], { type: `${mime};charset=utf-8` }));

/** RFC 4180: quote a field when it has a comma, quote or line break. */
export function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    const text = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const downloadCsv = (name: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]) =>
  downloadText(name, toCsv(headers, rows), "text/csv");

export function downloadCanvas(name: string, canvas: HTMLCanvasElement | null): void {
  canvas?.toBlob((blob) => blob && save(name, blob, canvas.ownerDocument));
}

/**
 * Save an on-screen SVG as a file. Theme colours are CSS variables, which a
 * standalone file cannot resolve, so the computed colours are written into it.
 */
export function downloadSvg(name: string, svg: SVGSVGElement | null): void {
  if (!svg) return;
  const view = svg.ownerDocument.defaultView ?? window;
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll<SVGElement>("*")];
  const to = [copy, ...copy.querySelectorAll<SVGElement>("*")];
  from.forEach((el, i) => {
    const css = view.getComputedStyle(el);
    for (const prop of ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-family", "font-size", "font-weight", "text-anchor"]) {
      to[i]!.style.setProperty(prop, css.getPropertyValue(prop));
    }
    to[i]!.removeAttribute("class");
  });
  const box = svg.getBoundingClientRect();
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(Math.round(box.width)));
  copy.setAttribute("height", String(Math.round(box.height)));
  copy.style.background = view.getComputedStyle(svg).getPropertyValue("--wb-canvas");
  save(name, new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }), svg.ownerDocument);
}

// ---- colour scales ------------------------------------------------------------
// Built from theme tokens with CSS colour mixing, so they follow the theme and
// work in SVG and HTML alike.

const clamp = (t: number) => Math.min(1, Math.max(0, t));

/** Magnitude: one hue, from the surface colour (low) to the accent (high). */
export const sequential = (t: number) => `color-mix(in oklab, var(--wb-accent) ${Math.round(18 + clamp(t) * 82)}%, var(--wb-canvas))`;

/** Polarity: loss colour below zero, gain colour above, a neutral surface at zero. `t` is in -1..1. */
export const diverging = (t: number) =>
  `color-mix(in oklab, var(${t >= 0 ? "--wb-good" : "--wb-bad"}) ${Math.round(clamp(Math.abs(t)) * 100)}%, var(--wb-canvas-alt))`;

/** Readable text colour on top of a scale colour of the given strength (0..1). */
export const inkOn = (strength: number) => (clamp(strength) > 0.55 ? "var(--wb-canvas)" : "var(--wb-text)");

/** The same scales as concrete colours, for canvas drawing where CSS variables are not available. */
export const mixer = (token: (name: string) => string) => ({
  sequential: (t: number) => `color-mix(in oklab, ${token("--wb-accent")} ${Math.round(18 + clamp(t) * 82)}%, ${token("--wb-canvas")})`,
  diverging: (t: number) =>
    `color-mix(in oklab, ${token(t >= 0 ? "--wb-good" : "--wb-bad")} ${Math.round(clamp(Math.abs(t)) * 100)}%, ${token("--wb-canvas-alt")})`,
});

// ---- sizing -------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

/** Size of an element, kept current as its panel is resized. For charts drawn as SVG. */
export function useBox<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox((b) => (b.width === el.clientWidth && b.height === el.clientHeight ? b : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, box];
}
