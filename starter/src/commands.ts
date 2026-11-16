import type { Command, Werkbank } from "@werkbank/framework";
import { z } from "zod";
import { connections } from "./data/connections";
import { feed } from "./market/feed";
import { SYMBOLS } from "./market/history";
import { ledger } from "./portfolio/ledger";
import { buildReport } from "./report";

/**
 * App-level commands. Like every command they are available from the palette,
 * to keybindings and to agents. Note the risk classes: placing an order has an
 * effect outside the workspace, so an agent needs a person's approval for it.
 */
export const commands: Command<Werkbank, any>[] = [
  {
    id: "order.place",
    title: "Place paper order",
    category: "Trading",
    // In a real app this reaches a broker. Here it is paper trading, but the class stays
    // "external" so the blueprint shows the approval path an order command must have.
    risk: "external",
    input: z.object({ symbol: z.enum(SYMBOLS), side: z.enum(["buy", "sell"]), qty: z.number().int().min(1).max(100_000) }),
    run: ({ actor }, i: { symbol: (typeof SYMBOLS)[number]; side: "buy" | "sell"; qty: number }) => {
      // A stale quote is not a price to trade on.
      if (!feed.isLive()) throw new Error(`No live quote: the feed is ${feed.getStatus()}.`);
      const quote = feed.getQuote(i.symbol);
      return ledger.fill({ ...i, price: i.side === "buy" ? quote.ask : quote.bid, actor });
    },
  },
  {
    id: "export.report",
    title: "Build a report from the open panels",
    category: "Export",
    risk: "read",
    palette: false, // the Report panel offers this with a preview and a download
    input: z.object({ panels: z.array(z.string()).optional(), format: z.enum(["markdown", "json"]).default("markdown") }),
    run: ({ wb }, i: { panels?: string[]; format: "markdown" | "json" }) => buildReport(wb, i.panels ?? null, i.format),
  },
  {
    id: "connection.test",
    title: "Test a data connection",
    category: "Data",
    risk: "local",
    log: false,
    input: z.object({ id: z.string() }),
    run: async (_ctx, i: { id: string }) => {
      const { id, name, status, message } = await connections.test(i.id);
      if (status !== "ok") throw new Error(message);
      return { id, name, status, message };
    },
  },
  {
    id: "api.get",
    title: "GET from an HTTP API connection",
    category: "Data",
    risk: "read",
    palette: false,
    input: z.object({ connection: z.string().describe("Id of a tested HTTP API connection"), path: z.string().describe("Path starting with /, including any query string") }),
    run: (_ctx, i: { connection: string; path: string }) => connections.apiGet(i.connection, i.path),
  },
  {
    id: "mcp.call",
    title: "Call a tool of a connected MCP server",
    category: "Data",
    // Another server's tool may change things there, so an agent needs the person's approval.
    risk: "external",
    palette: false,
    input: z.object({
      connection: z.string().describe("Id of a tested MCP server connection; its tools are listed in the Data connections panel's data"),
      tool: z.string(),
      arguments: z.record(z.string(), z.unknown()).optional(),
    }),
    run: (_ctx, i: { connection: string; tool: string; arguments?: Record<string, unknown> }) => connections.mcpCall(i.connection, i.tool, i.arguments ?? {}),
  },
  {
    id: "sql.query",
    title: "Run a read-only SQL query",
    category: "Data",
    risk: "read",
    palette: false, // the SQL console is the place to type one
    input: z.object({
      connection: z.string().describe("Id of a connection that has been tested, e.g. \"research\""),
      sql: z.string().max(4000).describe("One SELECT statement. Tables: dbo.Orders, dbo.Fills, dbo.Positions, dbo.Quotes, dbo.Tasks"),
    }),
    run: ({ wb }, i: { connection: string; sql: string }) => connections.query(i.connection, i.sql, Number(wb.settings.get<string>("data.rowLimit"))),
  },
  {
    id: "portfolio.reset",
    title: "Reset paper portfolio to the opening book",
    category: "Trading",
    risk: "irreversible",
    run: () => ledger.reset(),
  },
  {
    id: "feed.pause",
    title: "Pause the data feed",
    category: "Feed",
    risk: "local",
    log: false,
    when: () => feed.getStatus() !== "paused",
    run: () => feed.pause(),
  },
  {
    id: "feed.resume",
    title: "Resume the data feed",
    category: "Feed",
    risk: "local",
    log: false,
    when: () => feed.getStatus() === "paused",
    run: () => feed.resume(),
  },
  {
    id: "feed.drop",
    title: "Simulate a dropped connection",
    category: "Feed",
    risk: "local",
    log: false,
    when: () => feed.getStatus() === "live",
    run: () => feed.drop(),
  },
];
