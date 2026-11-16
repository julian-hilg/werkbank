import type { AssistantInfo, Werkbank } from "./werkbank";

/**
 * Everything a person needs to connect a coding agent of their own to this
 * app: the commands that register the app's MCP server with the agent, and a
 * briefing to paste as the first message. It is generated from the app's own
 * configuration, so every app built on the framework gets its own.
 */
export interface AssistantSetup {
  serverName: string;
  url: string;
  /** One-line commands (or config snippets) per agent. */
  connect: { id: string; label: string; kind: "command" | "config"; where: string; text: string }[];
  prompt: string;
}

const DEFAULT_URL = "http://127.0.0.1:8787/mcp";

export function assistantSetup(wb: Werkbank, info: AssistantInfo | null): AssistantSetup {
  const { config } = wb;
  const serverName = (config.assistant?.serverName ?? config.appId).replace(/[^\w-]/g, "-");
  const url = info?.mcp.url ?? DEFAULT_URL;
  const stdio = info?.mcp.stdio ?? { command: "node", args: ["packages/bridge/src/server.js"] };
  const tools = [...wb.tools.values()].filter((t) => !t.personal);
  const categories = [...new Set(wb.commands.list().map((c) => c.category ?? "General"))].sort();
  const topics = Object.keys(config.topics ?? {});

  const prompt = [
    `You are connected to "${config.title}", an application that is running on my machine, through the MCP server "${serverName}". I am looking at it now; what you do there appears on my screen.`,
    config.assistant?.brief,
    `It is a dockable workspace: panels arranged in a layout, some of them linked so they share context${topics.length ? ` (${topics.join(", ")})` : ""}.`,
    [
      "How to work with it:",
      "1. Call werkbank_describe for a short summary of what is open. Pass panel ids to get the data behind those panels. Do not ask for everything at once.",
      "2. Call werkbank_commands to find what you can do (pass a query), and pass command ids to get their input schemas.",
      "3. Act with werkbank_run, or werkbank_batch for several steps. Read the result before the next step.",
      "4. If I ask for a panel or view the app does not have, build it as a custom element: call werkbank_element_guide, write one HTML document against that API, and save it with werkbank_save_element (open: true).",
    ].join("\n"),
    `Panel types available: ${tools.map((t) => `${t.title} (${t.id})`).join(", ")}.`,
    `Command groups: ${categories.join(", ")}.`,
    [
      "Rules:",
      "- Every command has a risk class. \"read\" and \"local\" run at once; \"local\" ones can be undone with history.undo. \"external\" and \"irreversible\" ones pause until I approve them in the app. If I deny one, do not retry it.",
      "- Report numbers exactly as the app gives them, and say so when data is marked stale, simulated or sample.",
      "- You have no access to the app beyond these tools. Do not guess at state: read it.",
    ].join("\n"),
    "Start by calling werkbank_describe and telling me in two sentences what is open.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    serverName,
    url,
    connect: [
      { id: "claude", label: "Claude Code", kind: "command", where: "Run in the folder you want to work from", text: `claude mcp add --transport http ${serverName} ${url}` },
      { id: "codex", label: "Codex", kind: "command", where: "Run once; Codex stores it in ~/.codex/config.toml", text: `codex mcp add ${serverName} --url ${url}` },
      {
        id: "json", label: "Other MCP clients", kind: "config", where: "Add to the client's MCP configuration (for example .mcp.json, or Cursor's mcp.json)",
        text: JSON.stringify({ mcpServers: { [serverName]: { type: "http", url } } }, null, 2),
      },
      {
        id: "stdio", label: "Clients without HTTP support", kind: "config", where: "Starts a local helper that forwards to the running bridge",
        text: JSON.stringify({ mcpServers: { [serverName]: { command: stdio.command, args: stdio.args } } }, null, 2),
      },
    ],
    prompt,
  };
}
