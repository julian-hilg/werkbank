// Copies each library's browser build into ./vendor, where index.js loads it as text.
// The libraries' own package "exports" do not all expose these files, so they are
// located on disk rather than imported. Runs on install (the "prepare" script).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FILES = {
  echarts: ["echarts", "dist/echarts.min.js"],
  d3: ["d3", "dist/d3.min.js"],
  chartjs: ["chart.js", "dist/chart.umd.min.js", "dist/chart.umd.js"],
  "lightweight-charts": ["lightweight-charts", "dist/lightweight-charts.standalone.production.js"],
  plotly: ["plotly.js-dist-min", "plotly.min.js"],
};

function find(name) {
  for (let dir = here; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(candidate)) return candidate;
    if (dir === dirname(dir)) return null;
  }
}

mkdirSync(join(here, "vendor"), { recursive: true });
for (const [id, [name, ...paths]] of Object.entries(FILES)) {
  const root = find(name);
  const file = root && paths.map((p) => join(root, p)).find(existsSync);
  if (!file) {
    console.warn(`[chart-libraries] ${name} is not installed yet; skipped.`);
    continue;
  }
  copyFileSync(file, join(here, "vendor", `${id}.js`));
}
