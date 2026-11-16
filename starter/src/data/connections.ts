import { z } from "zod";
import { SYMBOLS, sectorOf } from "../market/history";
import { feed } from "../market/feed";
import { ledger } from "../portfolio/ledger";
import { liveValuation } from "../portfolio/live";
import { tasks } from "../tasks/store";
import { orders } from "./orders";
import { runQuery, type QueryResult, type Table } from "./sql";

/**
 * Data connections: an example of how an app built on the framework lets a
 * person set up, test and use outside sources. Three kinds are shown:
 * Microsoft SQL Server, an HTTP API, and another MCP server.
 *
 * The API and MCP kinds are real: requests go through the app's bridge, which
 * can reach servers a browser page cannot. The SQL Server kind is simulated.
 *
 * A browser cannot speak to SQL Server directly, so in a real app `connect`
 * and `query` below call the app's own backend, which holds the driver and
 * the credentials. Here they are simulated in the page: the "server" is a set
 * of sample tables, and the rules for what connects are written out in
 * `connect` so the failure paths can be tried. Everything else (the settings,
 * validation, status, where the secret lives, the read-only rule) is as it
 * would be.
 */
export const mssqlSchema = z.object({
  name: z.string().trim().min(2, "Give the connection a name.").max(40),
  server: z.string().trim().min(1, "Enter the server's host name.").regex(/^[\w.-]+(\\[\w-]+)?$/, "A host name, optionally with an instance: host\\INSTANCE."),
  port: z.number("Enter a port number.").int().min(1).max(65535),
  database: z.string().trim().min(1, "Enter the database name."),
  auth: z.enum(["sql", "windows", "entra"]),
  user: z.string().trim().max(80),
  encrypt: z.boolean(),
  trustServerCertificate: z.boolean(),
  timeoutSeconds: z.number("Enter a number of seconds.").int().min(1, "At least one second.").max(120, "At most 120 seconds."),
  /** Shared connections belong to the app; private ones are a person's own and are what custom elements may use. */
  scope: z.enum(["shared", "private"]),
}).refine((c) => c.auth !== "sql" || c.user.length > 0, { path: ["user"], message: "SQL Server authentication needs a user name." });
export type MssqlConfig = z.infer<typeof mssqlSchema>;

/** An HTTP API. Requests are GET only: a connection is for reading. */
export const restSchema = z.object({
  name: z.string().trim().min(2, "Give the connection a name.").max(40),
  baseUrl: z.string().trim().regex(/^https?:\/\/[^\s/]+/, "Enter an address starting with http:// or https://."),
  auth: z.enum(["none", "bearer", "header"]),
  /** Name of the header that carries the key, for auth "header". */
  headerName: z.string().trim().max(60),
  /** A path that answers when the API is up; used by "Test connection". */
  testPath: z.string().trim().regex(/^\/\S*$/, "A path starting with /."),
  scope: z.enum(["shared", "private"]),
}).refine((c) => c.auth !== "header" || /^[A-Za-z][\w-]*$/.test(c.headerName), { path: ["headerName"], message: "Enter the header's name, for example X-API-Key." });
export type RestConfig = z.infer<typeof restSchema>;

/** Another MCP server, reached over streamable HTTP. Its tools become available to the app. */
export const mcpSchema = z.object({
  name: z.string().trim().min(2, "Give the connection a name.").max(40),
  url: z.string().trim().regex(/^https?:\/\/[^\s/]+/, "Enter the server's address, starting with http:// or https://."),
  auth: z.enum(["none", "bearer"]),
  scope: z.enum(["shared", "private"]),
});
export type McpConfig = z.infer<typeof mcpSchema>;

export const KINDS = { mssql: "SQL Server", rest: "HTTP API", mcp: "MCP server" } as const;
export type Kind = keyof typeof KINDS;
export const SCHEMAS = { mssql: mssqlSchema, rest: restSchema, mcp: mcpSchema } as const;
type ConfigOf = { mssql: MssqlConfig; rest: RestConfig; mcp: McpConfig };
export type AnyConfig = { [K in Kind]: { kind: K } & ConfigOf[K] }[Kind];

interface Tested {
  id: string;
  status: "untested" | "ok" | "failed";
  message: string;
  testedAt: string | null;
}
export type Connection = AnyConfig & Tested;
export type MssqlConnection = Extract<Connection, { kind: "mssql" }>;

export interface McpTool {
  name: string;
  title: string | null;
  description: string;
  readOnly: boolean;
  inputSchema: unknown;
}
/** How the store reaches things a page cannot: the app wires this to the bridge's outbound services. */
export type Remote = (service: string, params: object) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;

export const blankConnection = (): MssqlConfig => ({
  name: "", server: "", port: 1433, database: "", auth: "sql", user: "", encrypt: true, trustServerCertificate: false, timeoutSeconds: 15, scope: "private",
});
export const blank = (kind: Kind): AnyConfig =>
  kind === "mssql"
    ? { kind, ...blankConnection() }
    : kind === "rest"
      ? { kind, name: "", baseUrl: "https://", auth: "none", headerName: "", testPath: "/", scope: "private" }
      : { kind, name: "", url: "http://", auth: "none", scope: "private" };

/** The simulated server. A real app replaces `connect` and `query` with calls to its backend. */
export const SAMPLE_SERVER = { host: "sql-research-01", databases: ["Research", "Risk"], user: "analyst", password: "demo", version: "Microsoft SQL Server 2022 (simulated)" };

async function connect(config: MssqlConfig, password: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 350 + Math.random() * 300));
  const host = config.server.split("\\")[0]!.toLowerCase();
  if (host !== SAMPLE_SERVER.host && host !== "localhost") throw new Error(`A network-related error occurred: the server "${config.server}" was not found or was not accessible (timeout after ${config.timeoutSeconds} s).`);
  if (config.port !== 1433) throw new Error(`No SQL Server is listening on ${config.server}:${config.port}.`);
  if (config.encrypt && !config.trustServerCertificate && host === "localhost") throw new Error("The certificate chain was issued by an authority that is not trusted. Use a trusted certificate, or tick \"Trust server certificate\" for a development server.");
  if (config.auth === "sql" && (config.user !== SAMPLE_SERVER.user || password !== SAMPLE_SERVER.password)) throw new Error(`Login failed for user '${config.user}'.`);
  if (!SAMPLE_SERVER.databases.some((d) => d.toLowerCase() === config.database.toLowerCase())) throw new Error(`Cannot open database "${config.database}" requested by the login. The login failed.`);
  return `${SAMPLE_SERVER.version}, database ${config.database}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** The sample tables. Positions, fills and quotes are live, so a query reflects the app's current state. */
export const TABLES: Table[] = [
  { name: "Orders", columns: ["id", "time", "symbol", "side", "qty", "price", "venue", "trader", "status"], rows: () => orders() as never },
  { name: "Fills", columns: ["id", "date", "symbol", "side", "qty", "price", "actor"], rows: () => ledger.getTrades().map(({ id, date, symbol, side, qty, price, actor }) => ({ id, date, symbol, side, qty, price, actor })) },
  {
    name: "Positions", columns: ["symbol", "sector", "qty", "avg_cost", "last", "value", "unrealised", "realised"],
    rows: () => liveValuation().rows.map((r) => ({ symbol: r.symbol, sector: sectorOf(r.symbol), qty: r.qty, avg_cost: r2(r.avgCost), last: r.last, value: r2(r.value), unrealised: r2(r.unrealised), realised: r2(r.realised) })),
  },
  { name: "Quotes", columns: ["symbol", "sector", "last", "bid", "ask", "prev_close", "volume"], rows: () => SYMBOLS.map((s) => { const q = feed.getQuote(s); return { symbol: s, sector: sectorOf(s), last: q.last, bid: q.bid, ask: q.ask, prev_close: q.prevClose, volume: q.volume }; }) },
  { name: "Tasks", columns: ["id", "title", "owner", "status", "priority", "due", "estimate_hours", "blocked"], rows: () => tasks.getAll().map((t) => ({ id: t.id, title: t.title, owner: t.owner, status: t.status, priority: t.priority, due: t.due, estimate_hours: t.estimateHours, blocked: t.blocked })) },
];

type Listener = () => void;
const KEY = "starter.connections.v2";
const BRIDGE = "http://127.0.0.1:8787";
const untested = { status: "untested" as const, message: "", testedAt: null };

/** The connections a new user starts with: one of each kind. */
const seeded = (): Connection[] => [
  { ...blankConnection(), id: "research", kind: "mssql", name: "Research warehouse", server: SAMPLE_SERVER.host, database: "Research", user: SAMPLE_SERVER.user, scope: "shared", ...untested },
  // Two real endpoints that exist whenever the app's own bridge is running, so these can be tried without any other server.
  { id: "bridge-api", kind: "rest", name: "Bridge status API", baseUrl: BRIDGE, auth: "none", headerName: "", testPath: "/health", scope: "shared", ...untested },
  { id: "app-mcp", kind: "mcp", name: "This app, over MCP", url: `${BRIDGE}/mcp`, auth: "none", scope: "shared", ...untested },
];

export class ConnectionStore {
  private connections: Connection[];
  /** Passwords, tokens and keys are held in memory for this page load only. They are never written to storage or to a workspace. */
  private secrets = new Map<string, string>();
  /** What a connected MCP server offers, as of its last test. */
  private tools = new Map<string, McpTool[]>();
  private listeners = new Set<Listener>();
  /** Set by the app: how to reach APIs and MCP servers (through the bridge). */
  remote: Remote = async () => ({ ok: false, error: "This app has no way to reach outside servers configured." });

  constructor(private storage: Pick<Storage, "getItem" | "setItem"> | null) {
    this.connections = this.load() ?? seeded();
  }

  list = (): Connection[] => this.connections;
  get = (id: string): Connection | undefined => this.connections.find((c) => c.id === id);
  hasSecret = (id: string): boolean => this.secrets.has(id);
  toolsOf = (id: string): McpTool[] => this.tools.get(id) ?? [];
  subscribe = (fn: Listener) => (this.listeners.add(fn), () => void this.listeners.delete(fn));

  /** Create or update. A changed connection is untested again. `config.kind` defaults to SQL Server. */
  save(id: string | null, config: AnyConfig | MssqlConfig, secret?: string): Connection {
    const kind: Kind = "kind" in config ? config.kind : "mssql";
    const checked = { kind, ...SCHEMAS[kind].parse(config) } as AnyConfig;
    const existing = id ? this.get(id) : undefined;
    const slug = checked.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "connection";
    let newId = existing?.id ?? slug;
    for (let n = 2; !existing && this.get(newId); n++) newId = `${slug}-${n}`;
    const connection = { ...checked, id: newId, ...untested } as Connection;
    if (secret !== undefined && secret !== "") this.secrets.set(newId, secret);
    this.tools.delete(newId);
    this.commit(existing ? this.connections.map((c) => (c.id === existing.id ? connection : c)) : [...this.connections, connection]);
    return connection;
  }

  remove(id: string): void {
    this.secrets.delete(id);
    this.tools.delete(id);
    this.commit(this.connections.filter((c) => c.id !== id));
  }

  /** The headers that authenticate a request to an HTTP API connection. */
  private headers(c: Extract<Connection, { kind: "rest" }>): Record<string, string> {
    const secret = this.secrets.get(c.id);
    if (c.auth === "none") return {};
    if (!secret) throw new Error(`Enter the ${c.auth === "bearer" ? "token" : "key"}. It is not stored, so it is needed once per session.`);
    return c.auth === "bearer" ? { authorization: `Bearer ${secret}` } : { [c.headerName]: secret };
  }

  private mcpParams(c: Extract<Connection, { kind: "mcp" }>) {
    const token = this.secrets.get(c.id);
    if (c.auth === "bearer" && !token) throw new Error("Enter the token. It is not stored, so it is needed once per session.");
    return { url: c.url, ...(c.auth === "bearer" ? { token } : {}) };
  }

  private async ask(service: string, params: object): Promise<any> {
    const result = await this.remote(service, params);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  async test(id: string): Promise<Connection> {
    const connection = this.get(id);
    if (!connection) throw new Error(`No connection called "${id}".`);
    let status: Connection["status"] = "ok";
    let message: string;
    try {
      if (connection.kind === "mssql") {
        if (connection.auth === "sql" && !this.secrets.has(id)) throw new Error("Enter the password. Passwords are not stored, so it is needed once per session.");
        message = await connect(connection, this.secrets.get(id) ?? "");
      } else if (connection.kind === "rest") {
        const answer = await this.ask("http.get", { url: connection.baseUrl.replace(/\/$/, "") + connection.testPath, headers: this.headers(connection) });
        if (!answer.ok) throw new Error(`The API answered ${answer.status}${answer.status === 401 || answer.status === 403 ? ": the credentials were not accepted" : ""}.`);
        message = `HTTP ${answer.status}, ${answer.contentType.split(";")[0] || "no content type"}`;
      } else {
        const answer = await this.ask("mcp.tools", this.mcpParams(connection));
        this.tools.set(id, answer.tools);
        message = `${answer.server}, ${answer.tools.length} tool${answer.tools.length === 1 ? "" : "s"}`;
      }
    } catch (error) {
      status = "failed";
      message = error instanceof Error ? error.message : String(error);
    }
    const tested = { ...connection, status, message, testedAt: new Date().toISOString() };
    this.commit(this.connections.map((c) => (c.id === id ? tested : c)));
    return tested;
  }

  /** A connection of the given kind that has passed its test in this session. */
  private ready<K extends Kind>(id: string, kind: K): Extract<Connection, { kind: K }> {
    const connection = this.get(id);
    if (!connection) throw new Error(`No connection called "${id}".`);
    if (connection.kind !== kind) throw new Error(`"${connection.name}" is a ${KINDS[connection.kind]} connection, not a ${KINDS[kind]} one.`);
    if (connection.status !== "ok") throw new Error(`The connection "${connection.name}" has not been tested successfully. Test it in the Data connections panel first.`);
    return connection as Extract<Connection, { kind: K }>;
  }

  /** Run a read-only query on a SQL Server connection. */
  query(id: string, sql: string, limit: number): QueryResult {
    this.ready(id, "mssql");
    return runQuery(sql, TABLES, limit);
  }

  /** GET a path from an HTTP API connection. */
  async apiGet(id: string, path: string): Promise<{ status: number; ok: boolean; contentType: string; body: unknown }> {
    const connection = this.ready(id, "rest");
    if (!/^\/\S*$/.test(path)) throw new Error("The path must start with / and contain no spaces.");
    return this.ask("http.get", { url: connection.baseUrl.replace(/\/$/, "") + path, headers: this.headers(connection) });
  }

  /** Call a tool of a connected MCP server. */
  async mcpCall(id: string, tool: string, args: unknown): Promise<{ isError: boolean; text: string; structured: unknown }> {
    const connection = this.ready(id, "mcp");
    if (!this.toolsOf(id).some((t) => t.name === tool)) throw new Error(`"${connection.name}" has no tool called "${tool}".`);
    return this.ask("mcp.call", { ...this.mcpParams(connection), tool, arguments: args ?? {} });
  }

  private commit(connections: Connection[]): void {
    this.connections = connections;
    try {
      // A stored connection is always untested on the next load: its session, and its secret, are gone.
      this.storage?.setItem(KEY, JSON.stringify(connections.map((c) => ({ ...c, ...untested }))));
    } catch {
      /* kept in memory */
    }
    this.listeners.forEach((fn) => fn());
  }

  private load(): Connection[] | null {
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) ?? "null");
      if (!Array.isArray(raw)) return null;
      // Keep only entries that still pass their kind's schema.
      const valid = raw.filter((c) => c && typeof c.id === "string" && c.kind in SCHEMAS && SCHEMAS[c.kind as Kind].safeParse(c).success);
      return valid.map((c) => ({ ...c, ...untested }));
    } catch {
      return null;
    }
  }
}

export const connections = new ConnectionStore(typeof localStorage === "undefined" ? null : localStorage);
