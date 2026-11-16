import type { CustomElement } from "@werkbank/framework";

/**
 * An element that went through review and now ships with the app. It started
 * as a custom element built in the Crafter; the submission package was
 * reviewed and added here. It still runs in the sandbox, with the same API.
 */
export const topMovers: CustomElement = {
  id: "top-movers",
  title: "Top movers",
  description: "The symbols that moved most today, from the watchlist's data.",
  author: "example",
  created: "2026-11-16T00:00:00.000Z",
  updated: "2026-11-16T00:00:00.000Z",
  revision: 1,
  status: "submitted",
  source: `<style>
  body { padding: 8px 10px; }
  h1 { margin: 0 0 6px; font-size: 1em; }
  .row { display: grid; grid-template-columns: 48px 1fr 62px; gap: 8px; align-items: center; height: 22px; cursor: pointer; }
  .row:hover { background: var(--wb-hover); }
  .track { position: relative; height: 10px; background: linear-gradient(var(--wb-text-dim), var(--wb-text-dim)) center / 1px 100% no-repeat; }
  .bar { position: absolute; top: 0; bottom: 0; }
  .up { left: 50%; background: var(--wb-good); }
  .down { right: 50%; background: var(--wb-bad); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .dim { color: var(--wb-text-dim); }
</style>
<h1>Top movers today <span class="dim">(simulated)</span></h1>
<div id="rows" class="dim">Open a watchlist to see movers.</div>
<script>
  async function refresh() {
    const panels = await werkbank.panels();
    const watch = panels.find((p) => p.tool === "watchlist");
    const root = document.getElementById("rows");
    if (!watch) { root.textContent = "Open a watchlist to see movers."; root.className = "dim"; return; }
    const data = await werkbank.data(watch.id);
    const rows = [...data.rows].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 6);
    const widest = Math.max(0.01, ...rows.map((r) => Math.abs(r.changePct)));
    root.className = "";
    root.innerHTML = rows.map((r) =>
      '<div class="row" data-symbol="' + r.symbol + '"><strong>' + r.symbol + '</strong><span class="track"><span class="bar ' +
      (r.changePct >= 0 ? "up" : "down") + '" style="width:' + (Math.abs(r.changePct) / widest * 50) + '%"></span></span><span class="num">' +
      (r.changePct >= 0 ? "+" : "\\u2212") + Math.abs(r.changePct).toFixed(2) + '%</span></div>').join("");
  }
  document.getElementById("rows").addEventListener("click", (e) => {
    const row = e.target.closest("[data-symbol]");
    if (row) werkbank.publish("symbol", row.dataset.symbol);
  });
  refresh();
  setInterval(refresh, 1000);
</script>`,
};
