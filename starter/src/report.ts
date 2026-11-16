import type { Werkbank } from "@werkbank/framework";

/**
 * Turns what the panels report about themselves into a document. It uses the
 * same `describe` data an agent reads, so a report is exactly what the app
 * can say about its own state, with no screen scraping.
 */
type Panel = { id: string; tool: string; title: string; linkGroup: string | null; links: Record<string, unknown>; state: unknown; data: unknown };

const isFlat = (value: unknown): value is Record<string, string | number | boolean | null> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((v) => v === null || typeof v !== "object");

const cell = (value: unknown) => (value === null || value === undefined ? "" : String(value).replace(/\|/g, "\\|").replace(/\n/g, " "));

function table(rows: Record<string, unknown>[], limit = 25): string {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const body = rows.slice(0, limit).map((r) => `| ${keys.map((k) => cell(r[k])).join(" | ")} |`);
  const more = rows.length > limit ? [`\n*${rows.length - limit} more rows not shown.*`] : [];
  return [`| ${keys.join(" | ")} |`, `| ${keys.map(() => "---").join(" | ")} |`, ...body, ...more].join("\n");
}

function render(value: unknown, depth: number): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "*none*";
    if (value.every(isFlat)) return table(value as Record<string, unknown>[]);
    if (value.every((v) => typeof v !== "object")) return value.join(", ");
    return "```json\n" + JSON.stringify(value, null, 1).slice(0, 1500) + "\n```";
  }
  const entries = Object.entries(value);
  const simple = entries.filter(([, v]) => v === null || typeof v !== "object");
  const nested = entries.filter(([, v]) => v !== null && typeof v === "object");
  const lines = simple.filter(([k]) => k !== "note").map(([k, v]) => `- **${k}:** ${cell(v)}`);
  const sections = nested.map(([k, v]) => `${"#".repeat(Math.min(6, depth))} ${k}\n\n${render(v, depth + 1)}`);
  return [lines.join("\n"), ...sections].filter(Boolean).join("\n\n");
}

export function buildReport(wb: Werkbank, panelIds: string[] | null, format: "markdown" | "json"): string {
  const view = wb.describe() as { app: string; workspace: string; panels: Panel[]; linkGroups: unknown };
  const panels = view.panels.filter((p) => !panelIds || panelIds.includes(p.id));
  if (format === "json") return JSON.stringify({ app: view.app, workspace: view.workspace, generated: new Date().toISOString(), panels }, null, 2);
  const parts = [
    `# ${view.app}: workspace "${view.workspace}"`,
    `*Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from ${panels.length} panel${panels.length === 1 ? "" : "s"}.*`,
    ...panels.map((p) => {
      const note = typeof (p.data as { note?: unknown } | undefined)?.note === "string" ? `> ${(p.data as { note: string }).note}\n\n` : "";
      const context = Object.entries(p.links).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k} = ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
      return `## ${p.title} (${p.id})\n\n${note}${context ? `*Context: ${context}*\n\n` : ""}${render(p.data ?? p.state, 3) || "*This panel reports no data.*"}`;
    }),
  ];
  return parts.join("\n\n") + "\n";
}
