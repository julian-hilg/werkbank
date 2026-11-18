/**
 * Charting libraries for sandboxed custom elements.
 *
 * A custom element has no network access, so it cannot load a library from a
 * CDN. Pass this map as `custom.libraries` in the app config and an element can
 * write `<script src="lib:echarts"></script>`; the framework puts the library's
 * code into the element's frame. Each library is its own lazily loaded chunk:
 * nothing is downloaded until an element that uses it is opened.
 *
 * Needs a bundler that supports `?raw` imports (Vite does).
 *
 * The libraries are other people's work under their own licences; see
 * THIRD-PARTY-NOTICES.md and vendor/licenses in this package.
 */
const text = (module) => module.default;

export const chartLibraries = {
  echarts: {
    title: "Apache ECharts 6",
    global: "echarts",
    description: "General-purpose charts on canvas: line, bar, candlestick, heatmap, sankey, sunburst, treemap, graph, gauge, parallel, and more. Best first choice.",
    load: () => import("./vendor/echarts.js?raw").then(text),
  },
  d3: {
    title: "D3 7",
    global: "d3",
    description: "Low-level building blocks for bespoke SVG or canvas visuals: scales, shapes, layouts (force, chord, hierarchy), geo, transitions.",
    load: () => import("./vendor/d3.js?raw").then(text),
  },
  chartjs: {
    title: "Chart.js 4",
    global: "Chart",
    description: "Simple, good-looking standard charts on canvas: line, bar, radar, doughnut, polar area, bubble, scatter.",
    load: () => import("./vendor/chartjs.js?raw").then(text),
  },
  "lightweight-charts": {
    title: "Lightweight Charts 5",
    global: "LightweightCharts",
    description: "Fast financial time-series charts: candlesticks, bars, lines, areas, histograms, with a time scale and crosshair. Leave its attribution logo on (layout.attributionLogo, on by default): the licence asks for that link to TradingView.",
    load: () => import("./vendor/lightweight-charts.js?raw").then(text),
  },
  plotly: {
    title: "Plotly 3",
    global: "Plotly",
    description: "Scientific and 3D charts: surfaces, 3D scatter, contours, statistical plots. Large (about 5 MB), so use it when the others cannot do the job.",
    load: () => import("./vendor/plotly.js?raw").then(text),
  },
};
