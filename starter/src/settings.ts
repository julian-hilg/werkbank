import type { SettingSpec } from "@werkbank/framework";
import { z } from "zod";

/**
 * Settings this app adds to the framework's own. Each appears in the settings
 * dialog under its section, with a control chosen from its type, and can be
 * read with `useSetting` or changed with the `settings.set` command.
 */
export const appSettings: SettingSpec<any>[] = [
  {
    key: "trading.defaultQuantity", title: "Default order quantity", section: "Trading",
    description: "The quantity a new order ticket starts with.",
    schema: z.number().int().min(1).max(100_000), default: 100,
  },
  {
    key: "market.simulateDrops", title: "Simulate connection drops", section: "Market data",
    description: "Let the simulated feed lose its connection for a few seconds now and then, so the stale-data handling stays visible.",
    schema: z.boolean(), default: true,
  },
  {
    key: "data.rowLimit", title: "Row limit for queries", section: "Data",
    description: "The most rows a SQL query returns to a panel or an agent.",
    schema: z.enum(["100", "500", "2000"]), default: "500",
    options: [{ value: "100", label: "100 rows" }, { value: "500", label: "500 rows" }, { value: "2000", label: "2,000 rows" }],
  },
];
