/**
 * Outbound services: things the app asks the bridge to do on its behalf,
 * because a browser page cannot. The bridge plays the part of an app's
 * backend here.
 *
 *   http.get   one GET request to an API (no other methods: connections are for reading)
 *   mcp.tools  connect to another MCP server and list its tools
 *   mcp.call   call one of that server's tools
 *
 * Only http and https URLs are accepted. Secrets arrive with each request and
 * are not kept or logged.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TIMEOUT_MS = 12_000;
const BODY_LIMIT = 200_000;

function checkedUrl(text) {
  let url;
  try {
    url = new URL(String(text));
  } catch {
    throw new Error(`"${text}" is not a URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https addresses can be reached.");
  return url;
}

const explain = (error, url) => {
  const cause = error?.cause?.code ?? error?.code;
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return `No answer from ${url.host} within ${TIMEOUT_MS / 1000} s.`;
  if (cause === "ECONNREFUSED") return `Nothing is listening at ${url.host}.`;
  if (cause === "ENOTFOUND") return `The host ${url.hostname} could not be found.`;
  // fetch reports most failures as "fetch failed" and puts the reason in the cause.
  return error?.cause?.message ? `${url.host} could not be reached: ${error.cause.message}.` : (error?.message ?? String(error));
};

async function httpGet({ url: address, headers = {} }) {
  const url = checkedUrl(address);
  let response;
  try {
    response = await fetch(url, { method: "GET", headers: { accept: "application/json, text/plain;q=0.8, */*;q=0.5", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
  } catch (error) {
    throw new Error(explain(error, url));
  }
  const contentType = response.headers.get("content-type") ?? "";
  const text = (await response.text()).slice(0, BODY_LIMIT);
  let body = text;
  if (contentType.includes("json")) {
    try {
      body = JSON.parse(text);
    } catch {
      /* leave it as text */
    }
  }
  return { status: response.status, ok: response.ok, contentType, body };
}

/** Connections to other MCP servers, kept open between requests. */
const clients = new Map();

async function mcpClient({ url: address, token }) {
  const url = checkedUrl(address);
  const key = `${url.href} ${token ? "auth" : "open"}`;
  const existing = clients.get(key);
  if (existing) return existing;
  const client = new Client({ name: "werkbank-bridge", version: "1" });
  const transport = new StreamableHTTPClientTransport(url, token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : undefined);
  transport.onclose = () => clients.delete(key);
  try {
    await client.connect(transport, { timeout: TIMEOUT_MS });
  } catch (error) {
    throw new Error(`Could not connect to the MCP server at ${url.href}: ${explain(error, url)}`);
  }
  clients.set(key, client);
  return client;
}

async function mcpTools(params) {
  const client = await mcpClient(params);
  const { tools } = await client.listTools(undefined, { timeout: TIMEOUT_MS });
  const info = client.getServerVersion();
  return {
    server: info ? `${info.title ?? info.name} ${info.version}` : "unknown server",
    instructions: client.getInstructions() ?? null,
    tools: tools.map((t) => ({ name: t.name, title: t.title ?? t.annotations?.title ?? null, description: t.description ?? "", readOnly: t.annotations?.readOnlyHint === true, inputSchema: t.inputSchema })),
  };
}

async function mcpCall({ tool, arguments: args, ...connection }) {
  const client = await mcpClient(connection);
  const result = await client.callTool({ name: String(tool), arguments: args ?? {} }, undefined, { timeout: 60_000 });
  const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n").slice(0, BODY_LIMIT);
  return { isError: Boolean(result.isError), text, structured: result.structuredContent ?? null };
}

const services = { "http.get": httpGet, "mcp.tools": mcpTools, "mcp.call": mcpCall };

/** Run one outbound service. Always resolves, to `{ ok, value }` or `{ ok, error }`. */
export async function outbound(name, params) {
  const service = services[name];
  if (!service) return { ok: false, code: "unknown", error: `The bridge has no service called "${name}".` };
  try {
    return { ok: true, value: await service(params ?? {}) };
  } catch (error) {
    return { ok: false, code: "failed", error: error?.message ?? String(error) };
  }
}
