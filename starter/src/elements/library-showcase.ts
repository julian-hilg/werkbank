import type { CustomElement } from "@werkbank/framework";

/**
 * Five shipped elements, one per charting library the app provides to custom
 * elements. They are ordinary elements: each runs in the sandbox, loads its
 * library with `<script src="lib:NAME">`, and takes its colours from the theme.
 * Use them as starting points in the Crafter.
 */
const meta = { author: "example", created: "2026-11-16T00:00:00.000Z", updated: "2026-11-16T00:00:00.000Z", revision: 1, status: "submitted" as const };

/** Shared by all five: theme colours as values a canvas library understands. */
const HEAD = `<style>
  html, body { height: 100%; }
  body { display: flex; flex-direction: column; overflow: hidden; }
  header { flex: none; padding: 5px 10px 3px; }
  header span, .dim { color: var(--wb-text-dim); }
  #chart { flex: 1; min-height: 0; position: relative; }
  #note { padding: 10px; color: var(--wb-text-dim); }
</style>
<script>
  const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = (colour) => { const c = document.createElement("canvas").getContext("2d"); c.fillStyle = colour; return c.fillStyle; };
  const mix = (a, b, t) => {
    const parts = (h) => [1, 3, 5].map((i) => parseInt(hex(h).slice(i, i + 2), 16));
    const A = parts(a), B = parts(b);
    return "rgb(" + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",") + ")";
  };
  const theme = () => ({ text: hex(tok("--wb-text")), dim: hex(tok("--wb-text-dim")), grid: hex(tok("--wb-grid")), canvas: hex(tok("--wb-canvas")), accent: hex(tok("--wb-accent")), good: hex(tok("--wb-good")), bad: hex(tok("--wb-bad")), font: tok("--wb-font") });
</script>`;

export const echartsSankey: CustomElement = {
  ...meta,
  id: "echarts-sankey",
  title: "Order routing (ECharts)",
  description: "A sankey diagram drawn with Apache ECharts. Sample data.",
  source: `${HEAD}
<header><strong>Order routing</strong> <span>desk to venue to outcome, orders per day (sample data)</span></header>
<div id="chart"></div>
<script src="lib:echarts"></script>
<script>
  const flows = [
    ["Equities desk", "Lit venue A", 420], ["Equities desk", "Lit venue B", 260], ["Equities desk", "Dark pool", 150],
    ["Macro desk", "Lit venue A", 180], ["Macro desk", "Internal cross", 140],
    ["Systematic", "Lit venue A", 310], ["Systematic", "Lit venue B", 390], ["Systematic", "Dark pool", 220], ["Systematic", "Internal cross", 90],
    ["Lit venue A", "Filled", 760], ["Lit venue A", "Part filled", 90], ["Lit venue A", "Cancelled", 60],
    ["Lit venue B", "Filled", 520], ["Lit venue B", "Part filled", 80], ["Lit venue B", "Cancelled", 50],
    ["Dark pool", "Filled", 190], ["Dark pool", "Part filled", 110], ["Dark pool", "Cancelled", 70],
    ["Internal cross", "Filled", 215], ["Internal cross", "Cancelled", 15],
  ];
  const names = [...new Set(flows.flatMap((f) => [f[0], f[1]]))];
  const chart = echarts.init(document.getElementById("chart"));
  function draw() {
    const t = theme();
    chart.setOption({
      textStyle: { fontFamily: t.font },
      tooltip: { trigger: "item", backgroundColor: t.canvas, borderColor: t.grid, textStyle: { color: t.text } },
      series: [{
        type: "sankey", left: 10, right: 110, top: 8, bottom: 10, nodeWidth: 12, nodeGap: 10, emphasis: { focus: "adjacency" },
        data: names.map((name) => ({ name, itemStyle: { color: t.accent, borderWidth: 0 } })),
        links: flows.map(([source, target, value]) => ({ source, target, value })),
        lineStyle: { color: mix(t.canvas, t.accent, 0.45), opacity: 0.45, curveness: 0.5 },
        label: { color: t.text, fontSize: 11 },
      }],
    });
  }
  draw();
  werkbank.onTheme(draw);
  new ResizeObserver(() => chart.resize()).observe(document.getElementById("chart"));
</script>`,
};

export const d3Pack: CustomElement = {
  ...meta,
  id: "d3-pack",
  title: "Volume bubbles (D3)",
  description: "Circle packing drawn with D3: symbols by sector, sized by today's volume, coloured by today's change. Reads the watchlist.",
  source: `${HEAD}
<style>
  svg { display: block; width: 100%; height: 100%; }
  text { fill: var(--wb-text); font-size: 11px; text-anchor: middle; pointer-events: none; }
  .leaf { cursor: pointer; stroke: var(--wb-canvas); stroke-width: 2px; }
  .group { fill: none; stroke: var(--wb-grid); }
</style>
<header><strong>Volume bubbles</strong> <span>size: volume today, colour: change today (simulated). Click a bubble to select the symbol.</span></header>
<div id="chart"><div id="note">Open a watchlist to see the bubbles.</div></div>
<script src="lib:d3"></script>
<script>
  const holder = document.getElementById("chart");
  let rows = null;
  function draw() {
    if (!rows) return;
    const t = theme();
    const width = holder.clientWidth, height = holder.clientHeight;
    if (width < 20 || height < 20) return;
    const widest = Math.max(0.5, ...rows.map((r) => Math.abs(r.changePct)));
    const sectors = d3.groups(rows, (r) => r.sector).map(([name, children]) => ({ name, children }));
    const root = d3.pack().size([width, height]).padding(4)(d3.hierarchy({ children: sectors }).sum((d) => (d.symbol ? Math.max(1, d.volume || 0) : 0)));
    const svg = d3.select(holder).selectAll("svg").data([0]).join("svg").attr("viewBox", [0, 0, width, height]);
    svg.selectAll("circle.group").data(root.children || []).join("circle").attr("class", "group").attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", (d) => d.r);
    svg.selectAll("circle.leaf").data(root.leaves(), (d) => d.data.symbol).join("circle").attr("class", "leaf")
      .attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", (d) => d.r)
      .attr("fill", (d) => mix(t.grid, d.data.changePct >= 0 ? t.good : t.bad, Math.min(1, Math.abs(d.data.changePct) / widest)))
      .on("click", (_e, d) => werkbank.publish("symbol", d.data.symbol))
      .selectAll("title").data((d) => [d]).join("title").text((d) => d.data.symbol + " (" + d.data.sector + "): " + d.data.changePct.toFixed(2) + "%, volume " + d3.format(",")(d.data.volume));
    svg.selectAll("text").data(root.leaves().filter((d) => d.r > 16), (d) => d.data.symbol).join("text").attr("x", (d) => d.x).attr("y", (d) => d.y + 4).text((d) => d.data.symbol);
  }
  async function refresh() {
    const watch = (await werkbank.panels()).find((p) => p.tool === "watchlist");
    if (!watch) return;
    const data = await werkbank.data(watch.id);
    if (!rows) holder.textContent = "";
    rows = data.rows;
    draw();
  }
  refresh();
  setInterval(refresh, 2000);
  werkbank.onTheme(draw);
  new ResizeObserver(draw).observe(holder);
</script>`,
};

export const chartjsMonthly: CustomElement = {
  ...meta,
  id: "chartjs-monthly",
  title: "Monthly returns (Chart.js)",
  description: "A bar chart drawn with Chart.js: the selected symbol's return per month. Follows the linked symbol.",
  source: `${HEAD}
<header><strong id="title">Monthly returns</strong> <span>close to close, per calendar month (simulated)</span></header>
<div id="chart"><canvas id="canvas"></canvas></div>
<script src="lib:chartjs"></script>
<script>
  let chart = null, months = [];
  function draw() {
    const t = theme();
    if (chart) chart.destroy();
    Chart.defaults.font.family = t.font;
    chart = new Chart(document.getElementById("canvas"), {
      type: "bar",
      data: { labels: months.map((m) => m.month), datasets: [{ data: months.map((m) => m.value), backgroundColor: months.map((m) => (m.value >= 0 ? t.good : t.bad)), borderRadius: 3 }] },
      options: {
        maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (c.parsed.y >= 0 ? "+" : "") + c.parsed.y.toFixed(2) + "%" } } },
        scales: {
          x: { ticks: { color: t.dim }, grid: { display: false }, border: { color: t.grid } },
          y: { ticks: { color: t.dim, callback: (v) => v + "%" }, grid: { color: t.grid }, border: { display: false } },
        },
      },
    });
  }
  werkbank.onLink("symbol", async (symbol) => {
    if (!symbol) return;
    const bars = await werkbank.call("bars", { symbol });
    const byMonth = new Map();
    for (const bar of bars) {
      const key = bar.date.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, { first: bar.open, last: bar.close });
      byMonth.get(key).last = bar.close;
    }
    months = [...byMonth].map(([month, m]) => ({ month, value: (m.last / m.first - 1) * 100 }));
    document.getElementById("title").textContent = symbol + " monthly returns";
    draw();
  });
  werkbank.onTheme(draw);
</script>`,
};

export const lightweightCandles: CustomElement = {
  ...meta,
  id: "lightweight-candles",
  title: "Candles (Lightweight Charts)",
  description: "Daily candlesticks drawn with Lightweight Charts. Follows the linked symbol.",
  source: `${HEAD}
<header><strong id="title">Candles</strong> <span>daily bars (simulated). Drag to pan, scroll to zoom.</span></header>
<div id="chart"></div>
<script src="lib:lightweight-charts"></script>
<script>
  const chart = LightweightCharts.createChart(document.getElementById("chart"), { autoSize: true });
  const series = chart.addSeries(LightweightCharts.CandlestickSeries, { borderVisible: false });
  function style() {
    const t = theme();
    chart.applyOptions({
      layout: { background: { color: t.canvas }, textColor: t.dim, fontFamily: t.font },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      timeScale: { borderColor: t.grid }, rightPriceScale: { borderColor: t.grid },
    });
    series.applyOptions({ upColor: t.good, wickUpColor: t.good, downColor: t.bad, wickDownColor: t.bad });
  }
  style();
  werkbank.onTheme(style);
  werkbank.onLink("symbol", async (symbol) => {
    if (!symbol) return;
    const bars = await werkbank.call("bars", { symbol });
    series.setData(bars.map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close })));
    chart.timeScale().fitContent();
    document.getElementById("title").textContent = symbol + " candles";
  });
</script>`,
};

export const plotlySurface: CustomElement = {
  ...meta,
  id: "plotly-surface",
  title: "3D surface (Plotly)",
  description: "A rotatable 3D surface drawn with Plotly. Sample data shaped like an implied-volatility surface.",
  source: `${HEAD}
<header><strong>3D surface</strong> <span>sample volatility surface. Drag to rotate, scroll to zoom.</span></header>
<div id="chart"></div>
<script src="lib:plotly"></script>
<script>
  const strikes = Array.from({ length: 25 }, (_, i) => 70 + i * 2.5);
  const months = Array.from({ length: 16 }, (_, i) => 1 + i * 1.5);
  // A smile that flattens with maturity, on a gently rising term structure.
  const z = months.map((m) => strikes.map((k) => 18 + 1.2 * Math.sqrt(m) + (0.9 * Math.pow((k - 100) / 10, 2) - 0.8 * (k - 100) / 10) / Math.sqrt(m)));
  const holder = document.getElementById("chart");
  function draw() {
    const t = theme();
    const axis = (text) => ({ title: { text }, color: t.dim, gridcolor: t.grid, backgroundcolor: t.canvas, showbackground: true, zerolinecolor: t.grid });
    try {
      Plotly.react(holder, [{ type: "surface", x: strikes, y: months, z, showscale: false, colorscale: [[0, mix(t.canvas, t.accent, 0.15)], [1, t.accent]], contours: { z: { show: true, usecolormap: true, project: { z: true } } },
        hovertemplate: "strike %{x}<br>%{y} months<br>vol %{z:.1f}%<extra></extra>" }],
        { paper_bgcolor: t.canvas, font: { color: t.text, family: t.font, size: 11 }, margin: { l: 0, r: 0, t: 0, b: 0 },
          scene: { xaxis: axis("Strike"), yaxis: axis("Months"), zaxis: axis("Vol %"), camera: { eye: { x: 1.5, y: -1.5, z: 0.8 } } } },
        { displayModeBar: false, responsive: true });
    } catch (e) {
      holder.innerHTML = '<div id="note">This view needs WebGL, which is not available here.</div>';
    }
  }
  draw();
  werkbank.onTheme(draw);
</script>`,
};

export const libraryShowcase = [echartsSankey, d3Pack, chartjsMonthly, lightweightCandles, plotlySurface];
