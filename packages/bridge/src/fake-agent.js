#!/usr/bin/env node
/**
 * Scripted agent for the automated checks. Reads the user's message on stdin,
 * connects to the app through the bridge's MCP server like a real agent, and
 * understands two requests: "show <SYMBOL>" and "how many panels".
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const [port, previous] = process.argv.slice(2);
const emit = (event) => console.log(JSON.stringify(event));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Say something the way a real agent does: piece by piece, then the finished passage. */
const say = async (text) => {
  for (const word of text.split(/(?<= )/)) {
    emit({ type: "delta", text: word });
    await pause(70);
  }
  emit({ type: "text", text });
};

let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
prompt = prompt.trim();

const turn = previous ? Number(previous.split("-")[1]) + 1 : 1;
emit({ type: "session", sessionId: `fake-${turn}` });

const client = new Client({ name: "fake-agent", version: "0.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./server.js", import.meta.url))],
    env: { ...process.env, BRIDGE_PORT: port }, // BRIDGE_APP is inherited
    stderr: "ignore",
  }),
);
const call = async (name, args = {}) => {
  emit({ type: "tool", name, input: args });
  const result = await client.callTool({ name, arguments: args });
  emit({ type: "tool_result", ok: !result.isError, summary: String(result.content[0]?.text ?? "").slice(0, 120) });
  return { ok: !result.isError, body: JSON.parse(result.content[0].text) };
};

emit({ type: "status", text: "thinking" });
const show = prompt.match(/^show (\w+)/i);
const crafting = prompt.match(/save it by calling werkbank_run with id "custom\.save" and input \{ "id": "([a-z0-9-]+)"/);
if (crafting) {
  // The Crafter's briefing: build the element it names. The request is the last paragraph.
  const request = prompt.slice(prompt.lastIndexOf("The request: ") + 13).trim();
  const source = `<h1 id="t">Built for: ${request.replace(/[<>&"]/g, "")}</h1><p id="n">loading</p><script>werkbank.panels().then((p) => { document.getElementById("n").textContent = p.length + " panels open"; });<\/script>`;
  const saved = await call("werkbank_run", { id: "custom.save", input: { id: crafting[1], title: "Panel counter", description: "Counts the open panels.", source } });
  await say(saved.ok ? "I built an element that counts the open panels." : `Saving failed: ${saved.body.error}`);
} else if (show) {
  const result = await call("werkbank_run", { id: "link.publish", input: { group: "1", topic: "symbol", value: show[1].toUpperCase() } });
  await say(result.ok ? `Group 1 now shows ${show[1].toUpperCase()}.` : `That did not work: ${result.body.error}`);
} else if (/how many panels/i.test(prompt)) {
  const view = await call("werkbank_describe", { detail: "summary" });
  await say(`There are ${view.body.panels.length} panels open. (turn ${turn})`);
} else if (/slowly/i.test(prompt)) {
  await say("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen");
} else {
  await say(`You said: ${prompt} (turn ${turn})`);
}
await client.close();
emit({ type: "done" });
