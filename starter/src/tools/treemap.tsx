import { defineTool, useLink, useToolState } from "@werkbank/framework";
import { useState } from "react";
import { z } from "zod";
import { useFeedStatus } from "../market/hooks";
import { sectorOf, type SymbolId } from "../market/history";
import { liveValuation, useValuation } from "../portfolio/live";
import { diverging, inkOn, useBox } from "./lib";
import { pct, signed, whole } from "./format";

const stateSchema = z.object({ colour: z.enum(["day", "total"]) });
type State = z.infer<typeof stateSchema>;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Squarified treemap: rows of tiles are built along the shorter side of the
 * remaining space, adding tiles while that keeps them closer to square.
 */
export function squarify<T>(items: { value: number; item: T }[], area: Box): (Box & { item: T })[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0 || area.w <= 0 || area.h <= 0) return [];
  const scale = (area.w * area.h) / total;
  const rest = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value).map((i) => ({ area: i.value * scale, item: i.item }));
  const out: (Box & { item: T })[] = [];
  let { x, y, w, h } = area;
  const worst = (row: number[], side: number) => {
    const sum = row.reduce((s, a) => s + a, 0);
    return Math.max((side * side * Math.max(...row)) / (sum * sum), (sum * sum) / (side * side * Math.min(...row)));
  };
  while (rest.length) {
    const side = Math.min(w, h);
    const row = [rest[0]!];
    while (row.length < rest.length) {
      const next = rest[row.length]!;
      if (worst([...row, next].map((r) => r.area), side) > worst(row.map((r) => r.area), side)) break;
      row.push(next);
    }
    rest.splice(0, row.length);
    const thickness = row.reduce((s, r) => s + r.area, 0) / side;
    let offset = 0;
    for (const r of row) {
      const length = r.area / thickness;
      out.push(w >= h ? { x, y: y + offset, w: thickness, h: length, item: r.item } : { x: x + offset, y, w: length, h: thickness, item: r.item });
      offset += length;
    }
    if (w >= h) (x += thickness), (w -= thickness);
    else (y += thickness), (h -= thickness);
  }
  return out;
}

function Treemap() {
  const [state, setState] = useToolState<State>();
  const [symbol, setSymbol] = useLink<SymbolId>("symbol");
  const [ref, box] = useBox<HTMLDivElement>();
  const [hover, setHover] = useState<SymbolId | null>(null);
  const v = useValuation();
  const stale = useFeedStatus() !== "live";
  const rows = v.rows.filter((r) => r.qty > 0);
  const change = (r: (typeof rows)[number]) => (state.colour === "day" ? r.day / (r.value - r.day || 1) : r.last / r.avgCost - 1);
  const extreme = Math.max(0.0001, ...rows.map((r) => Math.abs(change(r))));
  const tiles = squarify(rows.map((r) => ({ value: r.value, item: r })), { x: 0, y: 0, w: box.width, h: box.height });
  const shown = rows.find((r) => r.symbol === hover);
  return (
    <div className="st-chart">
      <div className="wb-toolhead">
        <strong>Positions by value</strong>
        {stale && <span className="wb-badge" data-tone="warn">stale prices</span>}
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="Colour by">
          {(["day", "total"] as const).map((colour) => (
            <button key={colour} className="wb-button" aria-pressed={state.colour === colour} onClick={() => setState({ colour })}>
              {colour === "day" ? "Colour: today" : "Colour: since cost"}
            </button>
          ))}
        </span>
      </div>
      <div className="st-readout wb-num">
        {shown
          ? `${shown.symbol} (${sectorOf(shown.symbol)})   value ${whole(shown.value)}   ${(shown.weight * 100).toFixed(1)}% of equity   today ${signed(shown.day)}   since cost ${pct(shown.last / shown.avgCost - 1)}`
          : "Area is position value; colour is the change. Click a tile to select the symbol."}
      </div>
      <div ref={ref} className={`st-fill st-treemap ${stale ? "wb-stale" : ""}`} onPointerLeave={() => setHover(null)}>
        {tiles.map((t) => {
          const c = change(t.item) / extreme;
          const roomy = t.w > 58 && t.h > 30;
          return (
            <button
              key={t.item.symbol}
              className="st-tile"
              aria-pressed={t.item.symbol === symbol}
              aria-label={`${t.item.symbol}, value ${whole(t.item.value)}, ${pct(change(t.item))}`}
              // Inset by 1 px on every side: a 2 px gap of surface between tiles.
              style={{ left: t.x + 1, top: t.y + 1, width: Math.max(0, t.w - 2), height: Math.max(0, t.h - 2), background: diverging(c), color: inkOn(Math.abs(c)) }}
              onPointerEnter={() => setHover(t.item.symbol)}
              onClick={() => setSymbol(t.item.symbol)}
            >
              {t.w > 34 && t.h > 16 && <strong>{t.item.symbol}</strong>}
              {roomy && <span className="wb-num">{pct(change(t.item))}</span>}
            </button>
          );
        })}
        {rows.length === 0 && <p className="st-blank">No positions.</p>}
      </div>
    </div>
  );
}

export const treemapTool = defineTool<State>({
  id: "treemap",
  title: "Position map",
  glyph: "▚",
  category: "Analytics",
  version: 1,
  stateSchema,
  defaultState: () => ({ colour: "day" }),
  links: ["symbol"],
  component: Treemap,
  describe: (state) => ({
    colourBy: state.colour,
    note: "Paper positions on simulated prices; area is value.",
    positions: liveValuation().rows.filter((r) => r.qty > 0).map((r) => ({
      symbol: r.symbol, sector: sectorOf(r.symbol), value: Math.round(r.value), weightPct: Number((r.weight * 100).toFixed(2)),
      dayPnl: Math.round(r.day), sinceCostPct: Number(((r.last / r.avgCost - 1) * 100).toFixed(2)),
    })),
  }),
});
