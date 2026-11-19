/**
 * Outbound services: things the app asks the bridge to do on its behalf,
 * because a browser page cannot. The bridge plays the part of an app's
 * backend here.
 *
 *   http.get      one GET request to an API
 *   http.request  one request with a method of its own (GET, POST, PUT, PATCH, DELETE) and a body.
 *                 It changes something somewhere else, so the command that uses it must be "external"
 *                 and waits for the person's approval when an agent runs it.
 *   mcp.tools  connect to another MCP server and list its tools
 *   mcp.call   call one of that server's tools
 *
 *   home.info    whether the app has a folder of its own here, and the names of its secrets
 *   store.read   read one of the files the app keeps in that folder (.werkbank/)
 *   store.write  replace one of them
 *
 * Only http and https URLs are accepted. A request can name a secret from the
 * app's .env file instead of carrying a credential: `auth: { secret: "NAME" }`
 * for http.get, `secret: "NAME"` for the MCP services. The bridge attaches the
 * value after checking that the address is one of the secret's hosts, does not
 * follow redirects with it, and removes it from the answer (see home.js).
 * Credentials that arrive with a request are not kept or logged.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { homeInfo, redact, secretFor, storeRead, storeWrite } from "./home.js";

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

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const REQUEST_LIMIT = 1_000_000;

const httpGet = (params, context) => httpRequest({ ...params, method: "GET", body: undefined, json: undefined }, context);

async function httpRequest({ url: address, method = "GET", headers = {}, auth, body, json }, { home }) {
  const url = checkedUrl(address);
  const verb = String(method).toUpperCase();
  if (!METHODS.includes(verb)) throw new Error(`The bridge sends ${METHODS.join(", ")}; not ${method}.`);
  // `json` is sent as JSON; `body` as the text it is.
  const payload = verb === "GET" ? undefined : json !== undefined ? JSON.stringify(json) : body === undefined ? undefined : String(body);
  if (payload !== undefined && payload.length > REQUEST_LIMIT) throw new Error(`That is more than the bridge sends in one request (${REQUEST_LIMIT / 1_000_000} MB).`);
  const contentHeader = json !== undefined && verb !== "GET" ? { "content-type": "application/json" } : {};
  // A secret named by the app: attached here, to this host only, and never followed to another address.
  const secret = auth?.secret ? secretFor(home, auth.secret, url) : null;
  const credential = !secret ? {} : auth.as === "header" ? { [checkedHeader(auth.header)]: secret } : { authorization: `Bearer ${secret}` };
  let response;
  try {
    response = await fetch(url, {
      method: verb,
      headers: { accept: "application/json, text/plain;q=0.8, */*;q=0.5", ...contentHeader, ...headers, ...credential },
      ...(payload !== undefined ? { body: payload } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // With a secret, or with anything but a read, the request goes to the address given and nowhere else.
      redirect: secret || verb !== "GET" ? "manual" : "follow",
    });
  } catch (error) {
    throw new Error(redact(explain(error, url), secret));
  }
  if ((secret || verb !== "GET") && response.status >= 300 && response.status < 400) throw new Error(`${url.host} answered with a redirect (HTTP ${response.status}). A request that carries a secret or changes something is not sent on to another address; use the final address.`);
  const contentType = response.headers.get("content-type") ?? "";
  const text = (await response.text()).slice(0, BODY_LIMIT);
  let answer = text;
  if (contentType.includes("json")) {
    try {
      answer = JSON.parse(text);
    } catch {
      /* leave it as text */
    }
  }
  return { status: response.status, ok: response.ok, contentType, body: redact(answer, secret) };
}

function checkedHeader(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(name)) throw new Error("Name the header the secret goes in, for example x-api-key.");
  return name.toLowerCase();
}

/** Connections to other MCP servers, kept open between requests. */
const clients = new Map();

async function mcpClient({ url: address, token: given, secret }, { home }) {
  const url = checkedUrl(address);
  const token = secret ? secretFor(home, secret, url) : given;
  // A connection opened with one app's secret is never handed to another app.
  const key = `${url.href} ${secret ? `secret ${secret} ${home}` : token ? "auth" : "open"}`;
  const existing = clients.get(key);
  if (existing) return existing;
  const client = new Client({ name: "werkbank-bridge", version: "1" });
  const transport = new StreamableHTTPClientTransport(url, token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : undefined);
  transport.onclose = () => clients.delete(key);
  try {
    await client.connect(transport, { timeout: TIMEOUT_MS });
  } catch (error) {
    throw new Error(redact(`Could not connect to the MCP server at ${url.href}: ${explain(error, url)}`, secret ? token : null));
  }
  clients.set(key, client);
  return client;
}

/** The value to strip from an answer, when the connection used a secret. */
const usedSecret = (params, { home }) => (params.secret ? secretFor(home, params.secret, checkedUrl(params.url)) : null);

async function mcpTools(params, context) {
  const client = await mcpClient(params, context);
  const { tools } = await client.listTools(undefined, { timeout: TIMEOUT_MS });
  const info = client.getServerVersion();
  return redact({
    server: info ? `${info.title ?? info.name} ${info.version}` : "unknown server",
    instructions: client.getInstructions() ?? null,
    tools: tools.map((t) => ({ name: t.name, title: t.title ?? t.annotations?.title ?? null, description: t.description ?? "", readOnly: t.annotations?.readOnlyHint === true, inputSchema: t.inputSchema })),
  }, usedSecret(params, context));
}

async function mcpCall({ tool, arguments: args, ...connection }, context) {
  const client = await mcpClient(connection, context);
  const result = await client.callTool({ name: String(tool), arguments: args ?? {} }, undefined, { timeout: 60_000 });
  const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n").slice(0, BODY_LIMIT);
  return redact({ isError: Boolean(result.isError), text, structured: result.structuredContent ?? null }, usedSecret(connection, context));
}

const NO_HOME = "This page may not use the app's folder. It must be served by the app's own dev server, with `bridgeProxy()` from @werkbank/bridge/vite in its Vite config.";
const needHome = (home) => {
  if (!home) throw new Error(NO_HOME);
  return home;
};

const services = {
  "http.get": httpGet,
  "http.request": httpRequest,
  "mcp.tools": mcpTools,
  "mcp.call": mcpCall,
  "home.info": (_params, { home }) => homeInfo(home),
  "store.read": ({ name }, { home }) => storeRead(needHome(home), String(name)),
  "store.write": ({ name, text }, { home }) => storeWrite(needHome(home), String(name), text),
};

/**
 * Run one service for an app. `context.home` is the app's folder, if its
 * connection came with one (see home.js). Always resolves, to `{ ok, value }` or `{ ok, error }`.
 */
export async function outbound(name, params, context = { home: null }) {
  const service = Object.hasOwn(services, name) ? services[name] : null;
  if (!service) return { ok: false, code: "unknown", error: `The bridge has no service called "${name}".` };
  try {
    return { ok: true, value: await service(params ?? {}, context) };
  } catch (error) {
    return { ok: false, code: "failed", error: error?.message ?? String(error) };
  }
}
