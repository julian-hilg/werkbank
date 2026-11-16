/**
 * The MCP face of the bridge: what an agent sees.
 *
 * Tools      six, deliberately few: four for the app, two for building custom elements. An app can have dozens of commands; rather
 *            than one tool per command (which would put every schema in the
 *            agent's context on every turn), the agent discovers commands on
 *            demand and runs them through one tool.
 * Resources  the same state as addressable, subscribable documents, for clients
 *            that attach context or want to be told when something changes.
 * Prompts    ready-made starting points a person can pick in their client.
 *
 * Results are returned both as text and as structured content, with a stated
 * output shape. Long waits (a person deciding on an approval) report progress.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const INSTRUCTIONS = [
  "This server connects you to a running Werkbank app that a person is looking at. You read its state and act on it through its own commands.",
  "Start with werkbank_describe (a short summary). Ask for the panels you need with detail \"full\" to get the data behind their view; do not request everything at once.",
  "Use werkbank_commands to find commands (optionally with a query), and pass ids to get their input schemas before running one you have not used.",
  "To build the person a panel of their own, call werkbank_element_guide and then werkbank_save_element.",
  "Act with werkbank_run, or werkbank_batch for several steps in a row. Every action is recorded in the app's history as yours; commands marked undoable can be reversed with the history.undo command.",
  "Commands of risk \"external\" or \"irreversible\" pause until the person approves them in the app. If one is denied, do not retry it.",
  "Data shown as stale or simulated is exactly that; say so when you report it.",
].join(" ");

const envelope = {
  ok: z.boolean().describe("Whether the request succeeded"),
  value: z.unknown().optional().describe("The result, when ok"),
  error: z.string().optional().describe("What went wrong, when not ok"),
  code: z.enum(["unknown", "invalid", "unavailable", "denied", "failed"]).optional().describe("Machine-readable failure kind"),
};

/** One result shape for every tool: text for models, structured content for programs. */
const reply = (result) => ({
  content: [{ type: "text", text: JSON.stringify(result.ok ? result.value : result) }],
  structuredContent: result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error, code: result.code },
  isError: !result.ok,
});

const PANEL = "werkbank://panel/";
const STATIC = {
  "werkbank://app": { name: "App summary", description: "What is open: layout, panels and link groups, without panel data.", read: (request) => request("describe", { detail: "summary" }) },
  "werkbank://workspace": { name: "Workspace document", description: "The saved workspace: layout tree, panel instances and their state, link groups.", read: (request) => request("read", { what: "workspace" }) },
  "werkbank://commands": { name: "Commands", description: "Every command with its risk class and input schema.", read: (request) => request("commands", { schemas: true }) },
  "werkbank://elements": { name: "Custom elements", description: "How to build a custom element for this app, and the person's existing ones.", read: (request) => request("elements", {}) },
  "werkbank://history": { name: "Action history", description: "What the person and agents have done, newest last, and whether each can be undone.", read: (request) => request("read", { what: "history" }) },
};

/**
 * @param {object} io
 * @param {(method: string, params?: object, onProgress?: (message: string) => void) => Promise<any>} io.request
 * @param {(listener: (changed: string[]) => void) => void} io.onNotice called with what changed in the app
 * @param {string} io.version
 */
export function createMcpServer({ request, onNotice, version }) {
  const mcp = new McpServer(
    { name: "werkbank", title: "Werkbank app bridge", version },
    { instructions: INSTRUCTIONS, capabilities: { resources: { subscribe: true, listChanged: true }, logging: {} } },
  );

  /** Relay "waiting for approval" from the app as MCP progress, if the client asked for progress. */
  const progressOf = (extra) => {
    const token = extra?._meta?.progressToken;
    if (token === undefined) return undefined;
    let step = 0;
    return (message) => void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++step, message } }).catch(() => {});
  };

  // ---- tools ------------------------------------------------------------------

  mcp.registerTool(
    "werkbank_describe",
    {
      title: "Describe the running app",
      description:
        "Reads the app. With no arguments it returns a short summary: the layout, each open panel (id, tool, title, link group, " +
        "shared context) and the link groups' values. Pass `panels` to get those panels in full, including their state and the " +
        "data behind their view (the numbers a chart plots, the rows a table holds). Prefer this to asking for everything.",
      inputSchema: {
        panels: z.array(z.string()).optional().describe("Panel ids to describe in full, e.g. [\"chart-1\", \"portfolio-1\"]"),
        detail: z.enum(["summary", "full"]).optional().describe("\"full\" with no `panels` returns every panel's data, which can be large"),
      },
      outputSchema: envelope,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ panels, detail }) => reply(await request("describe", { panels, detail: detail ?? (panels ? "full" : "summary") })),
  );

  mcp.registerTool(
    "werkbank_commands",
    {
      title: "Find the app's commands",
      description:
        "Lists the app's commands: id, title, category, risk class (read, local, external, irreversible), whether it is available " +
        "now and whether it can be undone. Pass `query` to search, and `ids` to get the JSON schema of those commands' input. " +
        "These are the same commands the person reaches through the command palette.",
      inputSchema: {
        query: z.string().optional().describe("Words to look for in the id, title or category, e.g. \"workspace\" or \"panel link\""),
        ids: z.array(z.string()).optional().describe("Return these commands with their input schemas"),
      },
      outputSchema: envelope,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, ids }) => reply(await request("commands", { query, ids })),
  );

  const RUN_NOTE =
    "The action appears in the app's history as yours. Commands of risk \"external\" or \"irreversible\" pause until the person " +
    "approves them in the app; a denial comes back with code \"denied\" and must not be retried.";

  mcp.registerTool(
    "werkbank_run",
    {
      title: "Run a command in the app",
      description: `Runs one command by id with the given input. ${RUN_NOTE} Input is checked against the command's schema; a rejection says which field was wrong.`,
      inputSchema: {
        id: z.string().describe("Command id, for example panel.open or link.publish"),
        input: z.record(z.string(), z.unknown()).optional().describe("Input object matching the command's schema"),
      },
      outputSchema: envelope,
      // Not read-only; but nothing here is silently destructive: changes are undoable or wait for approval.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, input }, extra) => reply(await request("run", { id, input }, progressOf(extra))),
  );

  mcp.registerTool(
    "werkbank_batch",
    {
      title: "Run several commands in order",
      description:
        `Runs commands one after another and stops at the first that fails, so later steps never act on a state the earlier ones ` +
        `did not reach. Returns each step's result. Use it to set up a workspace or apply a multi-step change in one call. ${RUN_NOTE}`,
      inputSchema: {
        steps: z
          .array(z.object({ id: z.string(), input: z.record(z.string(), z.unknown()).optional() }))
          .min(1)
          .max(20)
          .describe("Commands to run, in order"),
      },
      outputSchema: envelope,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ steps }, extra) => reply(await request("batch", { steps }, progressOf(extra))),
  );

  // ---- building custom elements ------------------------------------------------
  // A custom element is a panel the person owns: one HTML document that runs in a sandbox
  // inside the app. These two tools are the builder; the app's Crafter panel uses the same path.

  mcp.registerTool(
    "werkbank_element_guide",
    {
      title: "How to build a custom element",
      description:
        "Read this before writing a custom element (a panel of the person's own, built as one HTML document that runs sandboxed in " +
        "the app). Returns the element API, the chart libraries the app provides to elements, the functions this app offers to elements, the shared context topics, the panels open now " +
        "(whose data an element can read) and the person's existing elements. Pass `id` to also get one element's current source.",
      inputSchema: { id: z.string().optional().describe("An existing element whose source you want, to change it") },
      outputSchema: envelope,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => reply(await request("elements", { id })),
  );

  mcp.registerTool(
    "werkbank_save_element",
    {
      title: "Create or update a custom element",
      description:
        "Saves a custom element and, if asked, opens it as a panel. The element is the person's own: it is stored in their browser, " +
        "listed with (C), runs without network access, and is not part of the shared app until it has been reviewed. Saving with an " +
        "existing id replaces that element (always send the complete source); the save is recorded in the history and can be undone. " +
        "Call werkbank_element_guide first, and werkbank_describe for the shape of any panel data the element reads.",
      inputSchema: {
        id: z.string().describe("Lowercase letters, digits and dashes, e.g. \"position-bars\""),
        title: z.string().describe("Short name shown on the tab"),
        description: z.string().optional().describe("One sentence on what it shows"),
        source: z.string().describe("The complete element: one HTML document with inline <style> and <script>"),
        open: z.boolean().optional().describe("Also open it as a panel so the person sees it"),
      },
      outputSchema: envelope,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, title, description, source, open }) => {
      const saved = await request("run", { id: "custom.save", input: { id, title, description, source } });
      if (!saved.ok) return reply(saved);
      const toolId = `c-${id}`;
      const opened = open ? await request("run", { id: "panel.open", input: { toolId } }) : null;
      return reply({ ok: true, value: { id, toolId, saved: true, panel: opened?.ok ? opened.value : null, ...(opened && !opened.ok ? { openFailed: opened.error } : {}) } });
    },
  );

  // ---- resources --------------------------------------------------------------

  const asResource = async (uri, result) => {
    if (!result.ok) throw new Error(result.error);
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(result.value) }] };
  };

  for (const [uri, spec] of Object.entries(STATIC)) {
    mcp.registerResource(spec.name, uri, { title: spec.name, description: spec.description, mimeType: "application/json" }, async () => asResource(uri, await spec.read(request)));
  }

  mcp.registerResource(
    "Panel",
    new ResourceTemplate(`${PANEL}{id}`, {
      // Every open panel is listed, so a client can offer them to attach as context.
      list: async () => {
        const summary = await request("describe", { detail: "summary" });
        if (!summary.ok) return { resources: [] };
        return {
          resources: summary.value.panels.map((p) => ({
            uri: `${PANEL}${p.id}`,
            name: `${p.title} (${p.id})`,
            description: `The ${p.tool} panel: its state and the data behind its view.`,
            mimeType: "application/json",
          })),
        };
      },
      complete: {
        id: async (value) => {
          const summary = await request("describe", { detail: "summary" });
          return summary.ok ? summary.value.panels.map((p) => p.id).filter((id) => id.startsWith(value)) : [];
        },
      },
    }),
    { title: "Panel", description: "One open panel: its state and the data behind its view.", mimeType: "application/json" },
    async (uri, { id }) => {
      const result = await request("describe", { panels: [String(id)], detail: "full" });
      if (result.ok && result.value.panels.length === 0) throw new Error(`No open panel has the id "${id}".`);
      return asResource(uri.href, result.ok ? { ok: true, value: result.value.panels[0] } : result);
    },
  );

  // Subscriptions: the app says what changed; subscribers to those resources are told.
  const subscribed = new Set();
  mcp.server.setRequestHandler(SubscribeRequestSchema, async ({ params }) => (subscribed.add(params.uri), {}));
  mcp.server.setRequestHandler(UnsubscribeRequestSchema, async ({ params }) => (subscribed.delete(params.uri), {}));
  onNotice((changed) => {
    if (!mcp.isConnected()) return;
    const uris = new Set();
    for (const what of changed) {
      if (what === "workspace") uris.add("werkbank://workspace").add("werkbank://app");
      else if (what === "history") uris.add("werkbank://history");
      else if (what.startsWith("panel:")) uris.add(`${PANEL}${what.slice(6)}`);
      else if (what === "panels" || what === "app") mcp.sendResourceListChanged();
    }
    for (const uri of uris) if (subscribed.has(uri)) void mcp.server.sendResourceUpdated({ uri }).catch(() => {});
    if (changed.includes("app")) void mcp.sendLoggingMessage({ level: "info", logger: "werkbank", data: "The set of connected app tabs changed." }).catch(() => {});
  });

  // ---- prompts ----------------------------------------------------------------

  const prompt = (text) => ({ messages: [{ role: "user", content: { type: "text", text } }] });

  mcp.registerPrompt(
    "tour",
    { title: "What am I looking at?", description: "Explain the open workspace: what each panel shows and how they are connected." },
    () => prompt("Describe the Werkbank app I have open. Read the summary first, then the panels that matter, and tell me in a few short paragraphs what each panel shows and which ones are linked. Mention anything stale or simulated."),
  );
  mcp.registerPrompt(
    "review_actions",
    { title: "Review recent actions", description: "Summarise what was done in the app recently, by whom, and what can still be undone." },
    () => prompt("Read the Werkbank action history (resource werkbank://history) and summarise what was done most recently, separating my actions from agents'. Point out anything that failed, and say which actions can still be undone."),
  );
  mcp.registerPrompt(
    "build_element",
    {
      title: "Build a panel of my own",
      description: "Describe a view you want; the agent builds it as a custom element and opens it in the app.",
      argsSchema: { request: z.string().describe("What the panel should show, e.g. \"my five largest positions as bars\"") },
    },
    ({ request: wanted }) =>
      prompt(`Build a custom element in the Werkbank app for this: ${wanted}. First call werkbank_element_guide, then werkbank_describe for the panels whose data you need, so you know its exact shape. Write the element to cope with that data being absent. Save it with werkbank_save_element and open it. Then tell me in two sentences what it shows and what it needs to be open.`),
  );
  mcp.registerPrompt(
    "arrange",
    {
      title: "Set up a workspace for a task",
      description: "Open and arrange the panels that suit a task you describe.",
      argsSchema: { task: z.string().describe("What you want to work on, e.g. \"compare two symbols' volatility\"") },
    },
    ({ task }) => prompt(`Set up the workspace for this task: ${task}. Look at which tools and presets the app offers, then open, link and arrange the panels that fit, using werkbank_batch. Reuse what is already open where it helps. Finish by telling me what you set up and why.`),
  );

  return mcp;
}
