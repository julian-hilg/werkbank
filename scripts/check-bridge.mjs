// End-to-end check of the agent bridge: node scripts/check-bridge.mjs
// Starts the bridge as an MCP client would, opens the app, and drives it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResourceListChangedNotificationSchema, ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { launch } from "./browser.mjs";

const URL = process.env.APP_URL ?? "http://localhost:5199/";
const PORT = "8791";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const client = new Client({ name: "bridge-check", version: "0.0.0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: ["packages/bridge/src/server.js"],
    // The scripted agent stands in for Claude Code, so the chat checks cost nothing.
    env: { ...process.env, BRIDGE_PORT: PORT, BRIDGE_AGENT: "fake" },
  }),
);
const call = async (name, args = {}, options) => {
  const result = await client.callTool({ name, arguments: args }, undefined, options);
  return { isError: Boolean(result.isError), body: JSON.parse(result.content[0].text), structured: result.structuredContent };
};
const updated = [];
let listChanges = 0;
client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => void updated.push(n.params.uri));
client.setNotificationHandler(ResourceListChangedNotificationSchema, () => void listChanges++);

const listed = (await client.listTools()).tools;
const tools = listed.map((t) => t.name).sort();
check("the bridge offers six tools: four for the app, two for building elements", tools.join(",") === "werkbank_batch,werkbank_commands,werkbank_describe,werkbank_element_guide,werkbank_run,werkbank_save_element", tools.join(","));
check("tools declare what they do and what they return", listed.every((t) => t.title && t.outputSchema && t.annotations) && listed.find((t) => t.name === "werkbank_describe").annotations.readOnlyHint === true && listed.find((t) => t.name === "werkbank_run").annotations.readOnlyHint === false);
check("the server tells the agent how to use it", /werkbank_describe/.test(client.getInstructions() ?? "") && /approv/.test(client.getInstructions() ?? ""));
const capabilities = client.getServerCapabilities();
check("it advertises resources with subscriptions, and prompts", capabilities.resources?.subscribe === true && capabilities.resources?.listChanged === true && Boolean(capabilities.prompts));

const offline = await call("werkbank_describe");
check("without an app it says how to connect one", offline.isError && /status bar/.test(offline.body.error));

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const APP = `${URL}?bridge=ws://127.0.0.1:${PORT}`;
await page.goto(APP);
await page.evaluate(() => {
  localStorage.clear();
});
await page.reload();
await page.waitForSelector("[data-testid=panel-chart-1] canvas");
await page.waitForFunction(() => /agent: connected/.test(document.querySelector(".wb-status")?.textContent ?? ""), null, { timeout: 8000 });
check("the app connects and shows it in the status bar", true);

const summary = await call("werkbank_describe");
check("describe starts with a compact summary", !summary.isError && summary.body.panels.length === 11 && summary.body.panels.every((p) => !("data" in p)) && JSON.stringify(summary.body).length < 9000, `${JSON.stringify(summary.body).length} characters`);
check("results come as structured content as well as text", summary.structured?.ok === true && summary.structured.value.panels.length === 11);
const view = await call("werkbank_describe", { panels: ["chart-1", "portfolio-1"] });
const chart = view.body.panels?.find((p) => p.id === "chart-1");
check("asking for panels returns their data", !view.isError && view.body.panels.length === 2 && chart?.data?.symbol === "DLTA" && chart.data.shown.bars === 120);
const book = view.body.panels.find((p) => p.id === "portfolio-1").data;
check("an agent can read the portfolio and its P&L", book.positions.length >= 5 && typeof book.pnl.day === "number" && book.equity > 0);

const commands = await call("werkbank_commands");
const open = commands.body.find?.((c) => c.id === "panel.open");
check("the command index is compact and says what can be undone", open?.risk === "local" && open.undoable === true && !("input" in open) && commands.body.length > 40);
const found = await call("werkbank_commands", { query: "workspace preset" });
check("commands can be searched", found.body.length === 1 && found.body[0].id === "workspace.preset");
const detailed = await call("werkbank_commands", { ids: ["panel.open", "order.place"] });
check("input schemas come on request", detailed.body.length === 2 && Boolean(detailed.body[0].input?.properties?.toolId) && detailed.body.find((c) => c.id === "order.place").risk === "external");

// --- resources ---
const resources = (await client.listResources()).resources;
check("state is also offered as resources, one per open panel", ["werkbank://app", "werkbank://workspace", "werkbank://commands", "werkbank://history"].every((u) => resources.some((r) => r.uri === u)) && resources.filter((r) => r.uri.startsWith("werkbank://panel/")).length === 11);
check("panels are addressable through a resource template", (await client.listResourceTemplates()).resourceTemplates.some((t) => t.uriTemplate === "werkbank://panel/{id}"));
const panelResource = JSON.parse((await client.readResource({ uri: "werkbank://panel/portfolio-1" })).contents[0].text);
check("reading a panel resource returns its data", panelResource.id === "portfolio-1" && panelResource.data.positions.length >= 5);
const missing = await client.readResource({ uri: "werkbank://panel/nope-9" }).then(() => null, (e) => String(e));
check("an unknown panel is an error that says so", /No open panel has the id/.test(missing ?? ""));
await client.subscribeResource({ uri: "werkbank://panel/notes-1" });
await client.subscribeResource({ uri: "werkbank://history" });
const listChangesBefore = listChanges;

const published = await call("werkbank_run", { id: "link.publish", input: { group: "1", topic: "symbol", value: "GOLF" } });
await page.waitForTimeout(150);
const heading = await page.locator("[data-testid=panel-chart-1] input[aria-label=Symbol]").inputValue();
check("an agent changes the symbol on screen", !published.isError && heading === "GOLF", heading);

const edit = await call("werkbank_run", { id: "panel.setState", input: { id: "notes-1", patch: { text: "changed by an agent" } } });
await page.waitForTimeout(900);
check("a subscriber is told when a resource changes", !edit.isError && updated.includes("werkbank://panel/notes-1") && updated.includes("werkbank://history"), updated.join(", "));
check("and is not told about resources it did not subscribe to", !updated.includes("werkbank://workspace") && !updated.some((u) => u.endsWith("chart-1")));

const batch = await call("werkbank_batch", { steps: [{ id: "view.theme", input: { theme: "dark" } }, { id: "panel.link", input: { id: "pnl-1", group: "2" } }, { id: "view.theme", input: { theme: "xp" } }] });
check("a batch runs its steps in order", !batch.isError && batch.body.completed === true && batch.body.stepsRun === 3 && (await page.evaluate(() => window.werkbank.getDoc().instances["pnl-1"].link)) === "2");
const broken = await call("werkbank_batch", { steps: [{ id: "panel.link", input: { id: "pnl-1", group: "3" } }, { id: "panel.close", input: { id: "nope" } }, { id: "view.theme", input: { theme: "dark" } }] });
check("a batch stops at the first failing step", broken.body.completed === false && broken.body.stepsRun === 2 && broken.body.results[1].ok === false && (await page.getAttribute("html", "data-theme")) === "xp");

const opened = await call("werkbank_run", { id: "panel.open", input: { toolId: "notes", state: { text: "written by an agent" }, target: { edge: "bottom" } } });
await page.waitForTimeout(700);
check("opening a panel announces that the list of resources changed", listChanges > listChangesBefore);
await page.waitForTimeout(150);
check("an agent opens a panel with state at a chosen place", !opened.isError && (await page.locator(`[data-testid=panel-${opened.body}] textarea`).inputValue()) === "written by an agent");

await page.waitForFunction(() => window.feed.getStatus() === "live", null, { timeout: 10000 });
const progress = [];
const order = call("werkbank_run", { id: "order.place", input: { symbol: "GOLF", side: "buy", qty: 10 } }, { onprogress: (p) => progress.push(p.message) });
await page.waitForSelector(".wb-dialog");
await page.waitForTimeout(300);
check("while an action waits for approval the agent is told so", /Waiting for the person to approve "Place paper order"/.test(progress[0] ?? ""), progress[0]);
await page.locator(".wb-dialog button", { hasText: "Approve" }).click();
const filled = await order;
check("an agent's paper order fills only after the person approves", !filled.isError && filled.body.actor === "agent" && filled.body.qty === 10);

const invalid = await call("werkbank_run", { id: "link.publish", input: { group: "9", topic: "symbol", value: "GOLF" } });
check("invalid input is refused with a reason", invalid.isError && invalid.body.code === "invalid");

await page.locator(".wb-rail-button[aria-label='Action history']").click();
const agentRows = await page.locator(".wb-actor[data-actor=agent]").count();
check("agent actions show in the history as the agent's", agentRows >= 6, `${agentRows} rows`);

await call("werkbank_run", { id: "workspace.save", input: { name: "scratch" } });
const pendingDelete = call("werkbank_run", { id: "workspace.delete", input: { name: "scratch" } });
await page.waitForSelector(".wb-dialog");
await page.screenshot({ path: "scripts/shots/approval.png" });
await page.locator(".wb-dialog button", { hasText: "Deny" }).click();
const denied = await pendingDelete;
const names = (await call("werkbank_describe")).body.savedWorkspaces;
check("an irreversible agent action waits for the person, and a denial holds", denied.isError && denied.body.code === "denied" && names.includes("scratch"));

const prompts = (await client.listPrompts()).prompts;
const arrange = await client.getPrompt({ name: "arrange", arguments: { task: "compare two symbols" } });
check("ready-made prompts are offered", prompts.map((p) => p.name).sort().join() === "arrange,build_element,review_actions,tour" && /compare two symbols/.test(arrange.messages[0].content.text));
const history = JSON.parse((await client.readResource({ uri: "werkbank://history" })).contents[0].text);
check("the history resource says who did what and what can be undone", history.some((e) => e.actor === "agent" && e.commandId === "order.place") && history.some((e) => e.undoable === true));

// Undo the most recent undoable agent action, which is opening the notes panel.
await call("werkbank_run", { id: "panel.focus", input: { id: opened.body } });
const undone = await call("werkbank_run", { id: "history.undo" });
await page.waitForTimeout(150);
check("an agent can undo its own action", !undone.isError && (await page.locator(`[data-testid=panel-${opened.body}]`).count()) === 0);

// --- the in-app chat: message -> bridge -> agent -> MCP -> app ---
await page.evaluate(() => window.werkbank.run("workspace.reset"));
await page.locator("[data-testid=tab-chat-1]").click();
const chat = page.locator("[data-testid=panel-chat-1]");
await page.waitForFunction(() => /Scripted test agent/.test(document.querySelector("[data-testid=panel-chat-1] .wb-toolhead button[title^='Answered by']")?.title ?? ""), null, { timeout: 5000 });
check("the panel's Setup button says which agent will answer", (await chat.locator(".wb-toolhead button", { hasText: /^Setup$/ }).count()) === 1);
const replies = () => chat.locator(".wb-chat-message[data-role=assistant]").count();
const say = async (text, panel = chat, target = page) => {
  const before = await panel.locator(".wb-chat-message[data-role=assistant], .wb-chat-message[data-role=error]").count();
  await panel.locator("textarea").fill(text);
  await panel.locator("textarea").press("Enter");
  await target.waitForFunction(
    (n) => {
      const root = document.querySelector("[data-testid=panel-chat-1]");
      const done = root.querySelectorAll(".wb-chat-message[data-role=assistant], .wb-chat-message[data-role=error]").length > n;
      return done && !root.querySelector(".wb-chat-status") && !root.querySelector("[data-streaming]");
    },
    before,
    { timeout: 30000 },
  );
};
await say("show ECHO");
const firstReply = await chat.locator(".wb-chat-message[data-role=assistant]").last().innerText();
const symbolNow = await page.locator("[data-testid=panel-chart-1] input[aria-label=Symbol]").inputValue();
check("a chat message reaches the agent, which changes the app through MCP", /now shows ECHO/.test(firstReply) && symbolNow === "ECHO", firstReply);
check("the chat shows the command the agent ran", /link\.publish/.test(await chat.locator(".wb-chat-tool").first().innerText()));
await say("how many panels are open?");
const secondReply = await chat.locator(".wb-chat-message[data-role=assistant]").last().innerText();
check("a follow-up continues the same agent session and reads the app", /There are 11 panels open\. \(turn 2\)/.test(secondReply), secondReply);
const lastAction = await page.evaluate(() => window.werkbank.getMeta().log.at(-1));
check("what the chat agent did is in the action history", lastAction.actor === "agent" && lastAction.commandId === "link.publish" && lastAction.input.value === "ECHO");
// --- streaming: the reply grows on screen while the agent writes it ---
const full = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen";
const repliesBefore = await replies();
await chat.locator("textarea").fill("count slowly");
await chat.locator("textarea").press("Enter");
const lengths = [];
const statuses = new Set();
for (let i = 0; i < 400; i++) {
  const snap = await page.evaluate((n) => {
    const root = document.querySelector("[data-testid=panel-chat-1]");
    const all = root.querySelectorAll(".wb-chat-message[data-role=assistant]");
    return { text: all.length > n ? all[all.length - 1].textContent : null, status: root.querySelector(".wb-chat-status")?.textContent ?? null };
  }, repliesBefore);
  if (snap.status) statuses.add(snap.status);
  if (snap.text !== null && lengths.at(-1) !== snap.text.length) lengths.push(snap.text.length);
  if (snap.text === full && snap.status === null) break;
  await page.waitForTimeout(25);
}
const growing = lengths.every((n, i) => i === 0 || n > lengths[i - 1]);
check("the reply appears piece by piece while it is being written", lengths.length >= 8 && growing && lengths.at(-1) === full.length, `${lengths.length} steps: ${lengths.slice(0, 12).join(",")}…`);
check("the panel says what the agent is doing meanwhile", statuses.has("thinking…") && statuses.has("writing…"), [...statuses].join(" | "));
check("the finished message is stored whole", (await page.evaluate(() => { const s = window.werkbank.getDoc().instances["chat-1"].state; return s.conversations.find((c) => c.id === s.active).messages.at(-1); })).text === full);

// --- several tabs of the app at once ---
const second = await browser.newPage({ viewport: { width: 1440, height: 860 } });
await second.goto(APP);
await second.waitForSelector("[data-testid=tab-chat-1]");
await second.waitForFunction(() => window.werkbank.getMeta().bridge === "connected", null, { timeout: 8000 });
await page.waitForTimeout(2500); // long enough for a reconnect fight to show
const both = [await page.evaluate(() => window.werkbank.getMeta().bridge), await second.evaluate(() => window.werkbank.getMeta().bridge)];
check("two tabs stay connected side by side", both[0] === "connected" && both[1] === "connected", both.join(", "));
await second.evaluate(() => window.werkbank.run("workspace.reset"));
await second.locator("[data-testid=tab-chat-1]").click();
await say("show HOTL", second.locator("[data-testid=panel-chat-1]"), second);
const symbols = [await page.evaluate(() => window.werkbank.linksOf("chart-1").symbol), await second.evaluate(() => window.werkbank.linksOf("chart-1").symbol)];
check("a chat's agent acts on the tab that asked, not on another", symbols[0] === "ECHO" && symbols[1] === "HOTL", symbols.join(", "));
await second.close();

// --- the builder as MCP functions: an external agent builds a panel for the person ---
const guide = await call("werkbank_element_guide");
check("the element guide gives the API, the app's host functions and what is open", /werkbank\.data\(panelId\)/.test(guide.body.api) && guide.body.hostFunctions.some((f) => f.name === "query") && guide.body.topics.includes("symbol") && guide.body.openPanels.length > 5);
const elementSaved = await call("werkbank_save_element", {
  id: "via-mcp", title: "Built over MCP", description: "Shows the linked symbol.",
  source: `<p id="s">waiting</p><script>werkbank.onLink("symbol", (v) => { document.getElementById("s").textContent = "symbol: " + v; });<\/script>`,
  open: true,
});
const builtPanel = elementSaved.body.panel;
await page.frameLocator(`[data-testid=panel-${builtPanel}] iframe`).locator("#s", { hasText: "symbol:" }).waitFor({ timeout: 10000 });
check("an agent can build an element and open it as a panel in one call", !elementSaved.isError && elementSaved.body.toolId === "c-via-mcp" && (await page.locator(`[data-testid=tab-${builtPanel}]`).innerText()).includes("Built over MCP (C)"));
const withSource = await call("werkbank_element_guide", { id: "via-mcp" });
check("it can read an element back to change it", withSource.body.element.source.includes("onLink") && withSource.body.elements.some((e) => e.id === "via-mcp" && e.status === "draft"));
const badElement = await call("werkbank_save_element", { id: "Not Valid", title: "x", source: "<p></p>" });
check("an invalid element is refused with a reason", badElement.isError && badElement.body.code === "invalid");
check("building over MCP is recorded as the agent's and can be undone", (await page.evaluate(() => window.werkbank.getMeta().log.filter((e) => e.commandId === "custom.save").at(-1))).actor === "agent");
await call("werkbank_run", { id: "custom.delete", input: { id: "via-mcp" } });

// --- any agent can connect by URL ---
const overHttp = new Client({ name: "http-check", version: "0.0.0" });
await overHttp.connect(new StreamableHTTPClientTransport(new globalThis.URL(`http://127.0.0.1:${PORT}/mcp`)));
const httpTools = (await overHttp.listTools()).tools.map((t) => t.name).sort();
const httpView = JSON.parse((await overHttp.callTool({ name: "werkbank_describe", arguments: {} })).content[0].text);
check("an agent can connect to the app by URL and gets the same tools", httpTools.join() === tools.join() && httpView.app === "Werkbank starter" && httpView.panels.length > 5, `${httpTools.length} tools over HTTP`);
const httpRun = await overHttp.callTool({ name: "werkbank_run", arguments: { id: "link.publish", input: { group: "1", topic: "symbol", value: "BRVO" } } });
check("and can act on it", !httpRun.isError && (await page.evaluate(() => window.werkbank.getDoc().links["1"].symbol)) === "BRVO");
await overHttp.close();
const foreign = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: "https://example.com" }, body: "{}" });
check("a web page from elsewhere is refused", foreign.status === 403);
const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
check("the bridge reports its health", health.name === "werkbank-bridge" && health.apps.includes("Werkbank starter"));

// --- the assistant setup window ---
await page.evaluate(() => window.werkbank.run("assistant.setup"));
await page.waitForSelector(".wb-setup");
const setupText = await page.locator(".wb-setup").innerText();
await page.locator("#setup-agent").click();
const agentsOffered = await page.locator(".wb-popup .wb-option").count();
await page.keyboard.press("Escape");
check("the setup window shows the connection and the agents found on this machine", /Connected to the agent bridge/.test(setupText) && agentsOffered >= 1 && (await page.locator(".wb-setup").count()) === 1);
check("it gives the command that registers this app with Claude Code", (await page.locator(".wb-setup pre.wb-code").innerText()) === `claude mcp add --transport http werkbank-starter http://127.0.0.1:${PORT}/mcp`);
await page.locator(".wb-setup .wb-segment button", { hasText: "Codex" }).click();
check("and with Codex", (await page.locator(".wb-setup pre.wb-code").innerText()) === `codex mcp add werkbank-starter --url http://127.0.0.1:${PORT}/mcp`);
await page.locator(".wb-setup .wb-segment button", { hasText: "Other MCP clients" }).click();
check("and a configuration for any other MCP client", JSON.parse(await page.locator(".wb-setup pre.wb-code").innerText()).mcpServers["werkbank-starter"].url.endsWith("/mcp"));
const briefing = await page.locator(".wb-setup-prompt").inputValue();
check("the briefing is written for this app", /"Werkbank starter"/.test(briefing) && /paper orders/.test(briefing) && /Vol surface \(vol-surface\)/.test(briefing) && /werkbank_describe/.test(briefing) && /symbol, range, task, country/.test(briefing));
await page.keyboard.press("Escape");

// --- conversations ---
await page.locator("[data-testid=tab-chat-1]").click();
await chat.locator("button", { hasText: "New chat" }).click();
await say("how many panels are open?");
await chat.locator("button", { hasText: "Chats" }).click();
const overview = await chat.locator(".wb-chat-overview-title").allInnerTexts();
check("earlier conversations are listed", overview.length === 2 && overview.includes("how many panels are open?") && overview.some((t) => t.startsWith("show ECHO")), overview.join(" | "));
check("a new conversation starts a new agent session", /\(turn 1\)/.test(await chat.locator(".wb-chat-message[data-role=assistant]").last().innerText()));
await chat.locator(".wb-chat-overview-open", { hasText: "show ECHO" }).click();
check("reopening one shows its messages", (await chat.locator(".wb-chat-message[data-role=user]").first().innerText()) === "show ECHO" && (await chat.locator(".wb-chat-message[data-role=assistant]").count()) >= 3);
await chat.locator(".wb-chat-overview-item", { hasText: "how many panels are open?" }).click({ button: "right" });
await page.locator(".wb-menu [role=menuitem]", { hasText: "Delete conversation" }).click();
check("a conversation can be deleted from its menu", (await chat.locator(".wb-chat-overview-title").count()) === 1);
await chat.locator(".wb-chat-overview-open").first().dblclick();
await chat.locator("input[aria-label='Conversation name']").fill("Symbol questions");
await page.keyboard.press("Enter");
check("a conversation can be renamed", (await chat.locator(".wb-chat-overview-title").first().innerText()) === "Symbol questions" && (await chat.locator(".wb-chat-title").innerText()) === "Symbol questions");
await chat.locator("button", { hasText: "Chats" }).click();

// --- connections to an HTTP API and to another MCP server, through the bridge ---
const made = await page.evaluate((port) => {
  const api = window.connections.save(null, { kind: "rest", name: "Check API", baseUrl: `http://127.0.0.1:${port}`, auth: "none", headerName: "", testPath: "/health", scope: "private" });
  const mcp = window.connections.save(null, { kind: "mcp", name: "Check MCP", url: `http://127.0.0.1:${port}/mcp`, auth: "none", scope: "private" });
  const dead = window.connections.save(null, { kind: "rest", name: "Nothing there", baseUrl: "http://127.0.0.1:59321", auth: "none", headerName: "", testPath: "/", scope: "private" });
  return { api: api.id, mcp: mcp.id, dead: dead.id };
}, PORT);
const runApp = (id, input, actor) => page.evaluate(([id, input, actor]) => window.werkbank.run(id, input, actor), [id, input, actor]);
const apiTest = await runApp("connection.test", { id: made.api });
check("an HTTP API connection is tested against the real server", apiTest.ok && /HTTP 200, application\/json/.test(apiTest.value.message), apiTest.value?.message ?? apiTest.error);
const apiGet = await runApp("api.get", { connection: made.api, path: "/health" }, "agent");
check("an agent can read from the API through a command", apiGet.ok && apiGet.value.body.name === "werkbank-bridge");
const deadTest = await runApp("connection.test", { id: made.dead });
check("an unreachable API fails with a plain reason", deadTest.ok === false && /Nothing is listening at 127\.0\.0\.1:59321/.test(deadTest.error), deadTest.error);
const mcpTest = await runApp("connection.test", { id: made.mcp });
const otherTools = await page.evaluate((id) => window.connections.toolsOf(id).map((t) => t.name), made.mcp);
check("an MCP server connection lists that server's tools", mcpTest.ok && /Werkbank app bridge .*, 6 tools/.test(mcpTest.value.message) && otherTools.includes("werkbank_describe"), mcpTest.value?.message ?? mcpTest.error);
const viaOther = await runApp("mcp.call", { connection: made.mcp, tool: "werkbank_describe", arguments: {} });
check("the app can call a tool on the other MCP server", viaOther.ok && viaOther.value.isError === false && JSON.parse(viaOther.value.text).app === "Werkbank starter");
const agentCall = runApp("mcp.call", { connection: made.mcp, tool: "werkbank_commands", arguments: {} }, "agent");
await page.waitForSelector(".wb-dialog");
await page.locator(".wb-dialog button", { hasText: "Deny" }).click();
check("an agent needs approval to call another server's tool", (await agentCall).code === "denied");
await page.evaluate(() => window.werkbank.run("workspace.preset", { name: "Data and build" }));
const connPanel = page.locator("[data-testid=panel-connections-1]");
await connPanel.locator(".wb-list-item", { hasText: "Check MCP" }).click();
check("the panel shows a connected MCP server's tools to try", (await connPanel.locator(".st-conn-tools li").count()) === 6);
await connPanel.locator(".wb-list-item", { hasText: "Check API" }).click();
await connPanel.locator(".st-conn-explore button", { hasText: "Send" }).click();
await connPanel.locator(".st-conn-output").waitFor();
check("and lets you try a GET on a connected API", /"werkbank-bridge"/.test(await connPanel.locator(".st-conn-output").innerText()));
await page.evaluate((ids) => Object.values(ids).forEach((id) => window.connections.remove(id)), made);
await page.evaluate(() => window.werkbank.run("workspace.reset"));
await page.locator("[data-testid=tab-chat-1]").click();

// --- the Crafter: describe an element, the agent builds it, preview it, submit it ---
await page.evaluate(() => window.werkbank.run("workspace.preset", { name: "Data and build" }));
const crafter = page.locator("[data-testid=panel-crafter-1]");
await crafter.locator("button", { hasText: "New element" }).first().click();
await crafter.locator("textarea[aria-label='Describe what to build or change']").fill("count the panels");
await crafter.locator("button", { hasText: "Build with the assistant" }).click();
await page.waitForFunction(() => window.werkbank.custom.get("element-1")?.title === "Panel counter", null, { timeout: 30000 });
const built = page.frameLocator("[data-testid=panel-crafter-1] iframe");
await built.locator("#n", { hasText: "panels open" }).waitFor({ timeout: 10000 });
check("the agent builds the element and the preview runs it", /Built for: count the panels/.test(await built.locator("#t").innerText()) && /^\d+ panels open$/.test(await built.locator("#n").innerText()), await built.locator("#n").innerText());
check("the Crafter shows what the agent did", /saved the element/.test(await crafter.locator(".wb-crafter-log").innerText()));
check("the new element is a tool marked (C), saved by the agent and undoable", (await page.evaluate(() => window.werkbank.tools.get("c-element-1")?.title)) === "Panel counter (C)" && (await page.evaluate(() => window.werkbank.getMeta().log.at(-1))).actor === "agent");
await crafter.locator("button", { hasText: "Open as a panel" }).click();
await page.waitForSelector("[data-testid=tab-c-element-1-1]");
check("it opens as a panel like any other tool", (await page.locator("[data-testid=tab-c-element-1-1]").innerText()).includes("Panel counter (C)"));
const [packageFile] = await Promise.all([page.waitForEvent("download"), crafter.locator("button", { hasText: "Submit for review" }).click()]);
const submission = JSON.parse(await (await import("node:fs/promises")).readFile(await packageFile.path(), "utf8"));
check("submitting produces a review package that names what the element uses", submission.kind === "werkbank-element-submission" && submission.element.id === "element-1" && submission.uses.api.includes("panels") && submission.frameworkVersion && packageFile.suggestedFilename() === "element-1.element.json", `uses: ${submission.uses.api.join(", ")}`);
check("the element is marked as submitted", (await page.evaluate(() => window.werkbank.custom.get("element-1").status)) === "submitted");
const agentSubmit = call("werkbank_run", { id: "custom.submit", input: { id: "element-1" } });
await page.waitForSelector(".wb-dialog");
await page.locator(".wb-dialog button", { hasText: "Deny" }).click();
check("an agent cannot submit an element without the person's approval", (await agentSubmit).body.code === "denied");
await page.evaluate(() => window.werkbank.run("workspace.reset"));
await page.locator("[data-testid=tab-chat-1]").click();

await page.screenshot({ path: "scripts/shots/chat.png" });
await page.reload();
await page.waitForSelector("[data-testid=tab-chat-1]");
check("the conversation survives a reload", (await page.evaluate(() => window.werkbank.getDoc().instances["chat-1"].state.conversations[0].messages.length)) >= 4);

await browser.close();
await client.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
