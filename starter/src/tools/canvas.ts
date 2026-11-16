import { useEffect, useRef, useState } from "react";

/** A canvas sized for the screen it is on, with access to theme tokens. */
export interface Surface {
  g: CanvasRenderingContext2D;
  width: number;
  height: number;
  token: (name: string) => string;
}

/** Works in popout windows too: sizes and styles come from the canvas's own window. */
export function prepare(canvas: HTMLCanvasElement): Surface | null {
  const view = canvas.ownerDocument.defaultView ?? window;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return null;
  const ratio = view.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const g = canvas.getContext("2d")!;
  g.scale(ratio, ratio);
  const css = view.getComputedStyle(canvas);
  const token = (name: string) => css.getPropertyValue(name).trim();
  g.font = `11px ${token("--wb-font")}`;
  return { g, width, height, token };
}

/** Redraws when `draw` changes or the canvas is resized. */
export function useCanvas(draw: (surface: Surface) => void) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize(`${el.clientWidth}x${el.clientHeight}`));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const surface = ref.current && prepare(ref.current);
    if (surface) draw(surface);
  }, [draw, size]);
  return ref;
}

/** Round axis values (1, 2, 2.5 or 5 times a power of ten) covering lo..hi. */
export function niceTicks(lo: number, hi: number, target = 4): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

/** Like `niceTicks`, but the first and last tick always enclose lo..hi, for axes whose marks must stay inside the plot. */
export function niceDomain(lo: number, hi: number, target = 4): number[] {
  const ticks = niceTicks(lo, hi, target);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : Math.abs(hi - lo) || 1;
  if (ticks[0]! > lo + step * 1e-9) ticks.unshift(ticks[0]! - step);
  if (ticks[ticks.length - 1]! < hi - step * 1e-9) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}
