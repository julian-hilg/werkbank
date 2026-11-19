import { Werkbank, bridgeService, chatTool, crafterTool, type WorkspaceSeed } from "@werkbank/framework";
import { z } from "zod";
import { chartLibraries } from "@werkbank/chart-libraries";
import { controlsTool } from "./tools/controls";
import { libraryShowcase } from "./elements/library-showcase";
import { commands } from "./commands";
import { connections } from "./data/connections";
import { topMovers } from "./elements/top-movers";
import { eventLog } from "./events";
import { feed } from "./market/feed";
import { SYMBOLS, history as dailyBars, isSymbol } from "./market/history";
import { pipelineCommands } from "./pipeline/commands";
import { ledger } from "./portfolio/ledger";
import { appSettings } from "./settings";
import { taskCommands } from "./tasks/commands";
import { tasks } from "./tasks/store";
import { bars } from "./tools/bars";
import { blotter } from "./tools/blotter";
import { board } from "./tools/board";
import { cadTool } from "./tools/cad";
import { chart } from "./tools/chart";
import { connectionsTool } from "./tools/connections";
import { correlationTool } from "./tools/correlation";
import { depthTool } from "./tools/depth";
import { diffTool } from "./tools/diff";
import { documentTool } from "./tools/document";
import { eventLogTool } from "./tools/eventlog";
import { exportTool } from "./tools/export";
import { gridTool } from "./tools/grid";
import { inspectorTool } from "./tools/inspector";
import { mapTool } from "./tools/map";
import { monitorTool } from "./tools/monitor";
import { networkTool } from "./tools/network";
import { notes } from "./tools/notes";
import { pipelineTool } from "./tools/pipeline";
import { pnl } from "./tools/pnl";
import { portfolio } from "./tools/portfolio";
import { returnsTool } from "./tools/returns";
import { scatterTool } from "./tools/scatter";
import { sqlTool } from "./tools/sql";
import { tape } from "./tools/tape";
import { taskForm } from "./tools/task-form";
import { taskList } from "./tools/tasks";
import { ticket } from "./tools/ticket";
import { timelineTool } from "./tools/timeline";
import { treemapTool } from "./tools/treemap";
import { volSurfaceTool } from "./tools/vol-surface";
import { watchlist } from "./tools/watchlist";

// ---- workspaces -----------------------------------------------------------------
// A workspace is data: which panels exist, how they are arranged, and what
// context they share. These are the ones the app ships with.

const split = (id: string, orientation: "horizontal" | "vertical", size: number, children: WorkspaceSeed["layout"]["root"][]) =>
  ({ type: "split" as const, id, orientation, size, children });
const tabs = (id: string, size: number, panels: string[], selectedId = panels[0]) =>
  ({ type: "tabset" as const, id, size, selectedId, tabs: panels.map((p) => ({ id: p })) });

const tradingDesk: WorkspaceSeed = {
  name: "default",
  links: { "1": { symbol: "DLTA", range: null } },
  instances: [
    { id: "watchlist-1", toolId: "watchlist", link: "1" },
    { id: "tape-1", toolId: "tape", link: "1" },
    { id: "depth-1", toolId: "depth", link: "1" },
    { id: "chart-1", toolId: "chart", link: "1" },
    { id: "portfolio-1", toolId: "portfolio", link: "1" },
    { id: "blotter-1", toolId: "blotter", link: "1" },
    { id: "bars-1", toolId: "bars", link: "1" },
    { id: "pnl-1", toolId: "pnl" },
    { id: "ticket-1", toolId: "ticket", link: "1" },
    { id: "notes-1", toolId: "notes" },
    { id: "chat-1", toolId: "chat" },
  ],
  layout: {
    root: split("root", "horizontal", 100, [
      split("left", "vertical", 24, [tabs("left-top", 42, ["watchlist-1"]), tabs("left-bottom", 58, ["tape-1", "depth-1"])]),
      split("centre", "vertical", 46, [tabs("centre-top", 60, ["chart-1"]), tabs("centre-bottom", 40, ["portfolio-1", "blotter-1", "bars-1"])]),
      split("right", "vertical", 30, [tabs("right-top", 64, ["pnl-1"]), tabs("right-bottom", 36, ["ticket-1", "chat-1", "notes-1"])]),
    ]),
  },
};

const analytics: WorkspaceSeed = {
  links: { "1": { symbol: "DLTA", range: null } },
  instances: [
    { id: "monitor-1", toolId: "monitor", link: "1" },
    { id: "correlation-1", toolId: "correlation", link: "1" },
    { id: "vol-surface-1", toolId: "vol-surface", link: "1" },
    { id: "returns-1", toolId: "returns", link: "1" },
    { id: "scatter-1", toolId: "scatter", link: "1" },
    { id: "treemap-1", toolId: "treemap", link: "1" },
    { id: "depth-1", toolId: "depth", link: "1" },
    { id: "chart-1", toolId: "chart", link: "1" },
    { id: "chat-1", toolId: "chat" },
  ],
  layout: {
    root: split("root", "horizontal", 100, [
      split("left", "vertical", 27, [tabs("left-top", 48, ["monitor-1"]), tabs("left-bottom", 52, ["correlation-1"])]),
      split("centre", "vertical", 43, [tabs("centre-top", 56, ["vol-surface-1", "chart-1"]), tabs("centre-bottom", 44, ["returns-1"])]),
      split("right", "vertical", 30, [tabs("right-top", 36, ["scatter-1"]), tabs("right-mid", 30, ["treemap-1"]), tabs("right-bottom", 34, ["depth-1", "chat-1"])]),
    ]),
  },
};

const showcase: WorkspaceSeed = {
  links: { "3": { country: "Germany" } },
  instances: [
    { id: "document-1", toolId: "document" },
    { id: "map-1", toolId: "map", link: "3" },
    { id: "pipeline-1", toolId: "pipeline" },
    { id: "grid-1", toolId: "grid" },
    { id: "diff-1", toolId: "diff" },
    { id: "eventlog-1", toolId: "eventlog" },
    { id: "cad-1", toolId: "cad" },
    { id: "inspector-1", toolId: "inspector" },
    { id: "export-1", toolId: "export" },
    { id: "chat-1", toolId: "chat" },
    { id: "controls-1", toolId: "controls", link: "3" },
  ],
  layout: {
    root: split("root", "horizontal", 100, [
      tabs("left", 26, ["document-1", "controls-1"]),
      split("centre", "vertical", 42, [tabs("centre-top", 55, ["map-1", "pipeline-1"]), tabs("centre-bottom", 45, ["grid-1", "diff-1", "eventlog-1"])]),
      split("right", "vertical", 32, [tabs("right-top", 52, ["cad-1"]), tabs("right-bottom", 48, ["inspector-1", "export-1", "chat-1"])]),
    ]),
  },
};

/** One panel per chart library that custom elements can use, and the framework's choice controls. */
const chartLibrariesPreset: WorkspaceSeed = {
  links: { "1": { symbol: "DLTA", range: null } },
  instances: [
    { id: "e-lightweight-candles-1", toolId: "e-lightweight-candles", link: "1" },
    { id: "e-chartjs-monthly-1", toolId: "e-chartjs-monthly", link: "1" },
    { id: "e-echarts-sankey-1", toolId: "e-echarts-sankey" },
    { id: "e-plotly-surface-1", toolId: "e-plotly-surface" },
    { id: "e-d3-pack-1", toolId: "e-d3-pack", link: "1" },
    { id: "watchlist-1", toolId: "watchlist", link: "1" },
    { id: "controls-1", toolId: "controls", link: "1" },
    { id: "crafter-1", toolId: "crafter" },
  ],
  layout: {
    root: split("root", "horizontal", 100, [
      split("left", "vertical", 36, [tabs("left-top", 55, ["e-lightweight-candles-1"]), tabs("left-bottom", 45, ["e-chartjs-monthly-1"])]),
      split("centre", "vertical", 36, [tabs("centre-top", 50, ["e-echarts-sankey-1", "crafter-1"]), tabs("centre-bottom", 50, ["e-plotly-surface-1"])]),
      split("right", "vertical", 28, [tabs("right-top", 30, ["watchlist-1"]), tabs("right-mid", 35, ["e-d3-pack-1"]), tabs("right-bottom", 35, ["controls-1"])]),
    ]),
  },
};

/** Data sources and a place to build your own panels. */
const dataAndBuild: WorkspaceSeed = {
  links: { "1": { symbol: "DLTA", range: null } },
  instances: [
    { id: "connections-1", toolId: "connections" },
    { id: "sql-1", toolId: "sql" },
    { id: "crafter-1", toolId: "crafter" },
    { id: "watchlist-1", toolId: "watchlist", link: "1" },
    { id: "e-top-movers-1", toolId: "e-top-movers", link: "1" },
    { id: "network-1", toolId: "network", link: "1" },
    { id: "chat-1", toolId: "chat" },
  ],
  layout: {
    root: split("root", "horizontal", 100, [
      split("left", "vertical", 40, [tabs("left-top", 46, ["connections-1"]), tabs("left-bottom", 54, ["sql-1"])]),
      split("centre", "vertical", 36, [tabs("centre-top", 62, ["crafter-1"]), tabs("centre-bottom", 38, ["chat-1"])]),
      split("right", "vertical", 24, [tabs("right-top", 34, ["watchlist-1"]), tabs("right-mid", 26, ["e-top-movers-1"]), tabs("right-bottom", 40, ["network-1"])]),
    ]),
  },
};

const taskTracker: WorkspaceSeed = {
  links: { "2": { task: "T-104" } },
  instances: [
    { id: "tasks-1", toolId: "tasks", link: "2" },
    { id: "board-1", toolId: "board", link: "2" },
    { id: "timeline-1", toolId: "timeline", link: "2" },
    { id: "task-form-1", toolId: "task-form", link: "2" },
    { id: "chat-1", toolId: "chat" },
  ],
  layout: {
    root: split("root", "horizontal", 100, [
      split("main", "vertical", 62, [tabs("main-top", 45, ["tasks-1"]), tabs("main-bottom", 55, ["board-1", "timeline-1"])]),
      split("side", "vertical", 38, [tabs("side-top", 62, ["task-form-1"]), tabs("side-bottom", 38, ["chat-1"])]),
    ]),
  },
};

/**
 * Everything that makes this app this app: its tools, the context topics
 * panels can share, its commands, and the workspaces it ships with.
 */
const ABOUT = `# Werkbank starter

This is the reference app of the Werkbank framework. It exists to show what the framework can do and to be copied from.

- **Trading desk** and **Analytics**: a paper-trading desk on a simulated market. The symbols are invented, prices are generated in this page, and orders never leave the browser.
- **Tasks**: a small task tracker, as an example of forms and records.
- **Showcase** and **Chart libraries**: maps, a CAD view, grids, documents, the framework's controls, and one panel per chart library that custom elements can use.
- **Data and build**: data connections (SQL Server is simulated; HTTP APIs and MCP servers are real) and the Crafter for building panels of your own.

Switch between them in the *Workspaces* view, under *Presets*.
`;

export const werkbank = new Werkbank({
  appId: "starter",
  title: "Werkbank starter",
  // The app's name and logo are fixed here. The person can hide the logo under Settings → Appearance.
  logo: "/logo.svg",
  docs: [{ id: "starter", title: "About this app", text: ABOUT }],
  tools: [
    controlsTool,
    watchlist, chart, monitorTool, depthTool, tape, portfolio, pnl, ticket, blotter, bars,
    volSurfaceTool, correlationTool, networkTool, returnsTool, scatterTool, treemapTool,
    taskList, taskForm, board, timelineTool,
    connectionsTool, sqlTool,
    documentTool, mapTool, cadTool, pipelineTool, diffTool, gridTool, inspectorTool, eventLogTool, exportTool, notes,
    chatTool, crafterTool,
  ],
  commands: [...commands, ...taskCommands, ...pipelineCommands],
  version: "0.7.0",
  settings: appSettings,
  assistant: {
    serverName: "werkbank-starter",
    brief:
      "It is the reference app of the Werkbank framework: a paper-trading desk, analytics, a task tracker and a set of showcase panels. All market data is simulated and the symbols are invented; orders are paper orders that never leave the browser. Placing an order (order.place) needs my approval.",
  },
  custom: {
    // Elements that passed review and ship with the app.
    elements: [topMovers, ...libraryShowcase],
    // Chart libraries an element can load with <script src="lib:NAME">. Each is fetched only when first used.
    libraries: chartLibraries,
    // What custom elements may call besides reading panel data. Read-only by design.
    hostFunctions: {
      get: {
        description: 'get({ connection, path }) sends one GET to a tested HTTP API connection and returns { status, ok, contentType, body }.',
        run: (args) => {
          const { connection, path } = (args ?? {}) as { connection?: string; path?: string };
          return connections.apiGet(String(connection ?? ""), String(path ?? ""));
        },
      },
      bars: {
        description: "bars({ symbol }) returns that symbol's daily bars, oldest first: [{ date: 'YYYY-MM-DD', open, high, low, close, volume }]. Simulated data.",
        run: (args) => {
          const { symbol } = (args ?? {}) as { symbol?: string };
          if (!isSymbol(symbol)) throw new Error(`"${symbol}" is not one of the app's symbols.`);
          return dailyBars(symbol);
        },
      },
      query: {
        description: 'query({ connection, sql }) runs one read-only SELECT on a tested data connection and returns { columns, rows, rowCount, truncated }. Tables: dbo.Orders, dbo.Fills, dbo.Positions, dbo.Quotes, dbo.Tasks.',
        run: (args, wb) => {
          const { connection, sql } = (args ?? {}) as { connection?: string; sql?: string };
          return connections.query(String(connection ?? ""), String(sql ?? ""), Number(wb.settings.get<string>("data.rowLimit")));
        },
      },
    },
  },
  topics: {
    symbol: z.enum(SYMBOLS),
    range: z.object({ from: z.string(), to: z.string() }).nullable(),
    task: z.string().nullable(),
    country: z.string().nullable(),
  },
  storage: localStorage,
  defaultWorkspace: tradingDesk,
  presets: { "Trading desk": tradingDesk, Analytics: analytics, Showcase: showcase, "Chart libraries": chartLibrariesPreset, "Data and build": dataAndBuild, Tasks: taskTracker },
});

// ---- event log ------------------------------------------------------------------
// One place that records what happens across the app's stores.

feed.subscribe("status", () => eventLog.push(feed.isLive() ? "info" : "warn", "feed", `Market feed is ${feed.getStatus()}.`));
let fills = ledger.getTrades().length;
ledger.subscribe(() => {
  const all = ledger.getTrades();
  if (all.length > fills) {
    const t = all.at(-1)!;
    eventLog.push("info", "orders", `Paper fill: ${t.side} ${t.qty} ${t.symbol} at ${t.price.toFixed(2)} (by ${t.actor}).`);
  } else if (all.length < fills) eventLog.push("warn", "orders", "Paper portfolio was reset to the opening book.");
  fills = all.length;
});
tasks.subscribe(() => eventLog.push("info", "tasks", `Task data changed: ${tasks.getAll().length} tasks.`));
let logged = 0;
let bridge = werkbank.getMeta().bridge;
werkbank.subscribeMeta(() => {
  const meta = werkbank.getMeta();
  for (const entry of meta.log.filter((e) => e.seq > logged)) {
    eventLog.push(entry.ok ? "info" : "error", "command", `${entry.actor}: ${entry.title}${entry.error ? ` failed: ${entry.error}` : ""}`);
    logged = entry.seq;
  }
  if (meta.bridge !== bridge) {
    bridge = meta.bridge;
    eventLog.push(bridge === "connected" ? "info" : "warn", "agent bridge", `Agent bridge is ${bridge}.`);
  }
});

// HTTP API and MCP server connections are reached through the bridge, which can go where a page cannot.
connections.remote = (service, params) => bridgeService(werkbank, service, params);

// Settings that drive the app's services rather than a panel.
const applySettings = () => (feed.autoDrop = werkbank.settings.get<boolean>("market.simulateDrops"));
applySettings();
werkbank.settings.subscribe(applySettings);

feed.connect();
