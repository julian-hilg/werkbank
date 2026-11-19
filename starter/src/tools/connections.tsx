import { Select, defineTool, openContextMenu, useMeta, useToolState, useWerkbank } from "@werkbank/framework";
import { useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { KINDS, SAMPLE_SERVER, SCHEMAS, blank, connections as store, type AnyConfig, type Connection, type Kind } from "../data/connections";

/** What the person has typed, as typed; numbers stay text until checked. It never includes the secret. */
type Draft = Record<string, string | boolean> & { kind: Kind };
const stateSchema = z.object({
  selected: z.string().nullable(),
  /** The unsaved form, kept so it survives a reload. */
  draft: z.record(z.string(), z.unknown()).nullable(),
});
type State = z.infer<typeof stateSchema>;

const NUMERIC = ["port", "timeoutSeconds"];
const toDraft = (c: AnyConfig | Connection): Draft => {
  const { id: _id, status: _status, message: _message, testedAt: _testedAt, ...config } = c as Connection;
  return Object.fromEntries(Object.entries(config).map(([k, v]) => [k, typeof v === "number" ? String(v) : v])) as Draft;
};
function check(draft: Draft) {
  const candidate = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, NUMERIC.includes(k) ? Number(v) : v]));
  const result = SCHEMAS[draft.kind].safeParse(candidate);
  if (result.success) return { ok: true as const, config: { kind: draft.kind, ...result.data } as AnyConfig };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) errors[String(issue.path[0])] ??= issue.message;
  return { ok: false as const, errors };
}
const STATUS = { ok: "connected", failed: "failed", untested: "not tested" } as const;
const SECRET = { mssql: "Password", rest: "Token or key", mcp: "Token" } as const;
/** A password or key has to be typed in unless the connection names a secret from the app's .env file. */
const needsSecret = (d: Draft) => (d.kind === "mssql" ? d.auth === "sql" : d.auth !== "none" && !d.secret);
const pretty = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

/** Try a connected source: a GET against an API, or a call to one of an MCP server's tools. */
function Explorer({ connection }: { connection: Connection }) {
  const wb = useWerkbank();
  const [path, setPath] = useState(connection.kind === "rest" ? connection.testPath : "");
  const [tool, setTool] = useState("");
  const [args, setArgs] = useState("{}");
  const [output, setOutput] = useState<{ ok: boolean; text: string } | null>(null);
  const tools = store.toolsOf(connection.id);
  const chosen = tools.find((t) => t.name === tool) ?? tools[0];
  const show = (result: { ok: boolean; value?: unknown; error?: string }) => setOutput({ ok: result.ok, text: result.ok ? pretty(result.value) : (result.error ?? "Failed.") });

  if (connection.kind === "rest") {
    return (
      <section className="st-conn-explore" aria-label="Try the API">
        <form className="wb-row" onSubmit={(e) => (e.preventDefault(), void wb.run("api.get", { connection: connection.id, path }).then(show))}>
          <span className="wb-badge">GET</span>
          <input className="wb-input" aria-label="Path" value={path} onChange={(e) => setPath(e.target.value)} />
          <button className="wb-button" type="submit">
            Send
          </button>
        </form>
        {output && <pre className={`st-conn-output ${output.ok ? "" : "wb-warn"}`}>{output.text}</pre>}
      </section>
    );
  }
  if (connection.kind === "mcp") {
    const call = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(args || "{}");
      } catch {
        return setOutput({ ok: false, text: "The arguments are not valid JSON." });
      }
      void wb.run("mcp.call", { connection: connection.id, tool: chosen?.name, arguments: parsed }).then(show);
    };
    return (
      <section className="st-conn-explore" aria-label="The server's tools">
        <ul className="st-conn-tools">
          {tools.map((t) => (
            <li key={t.name}>
              <button className="wb-list-item" aria-current={t.name === chosen?.name || undefined} onClick={() => (setTool(t.name), setOutput(null))}>
                <code>{t.name}</code>
                {t.readOnly && <span className="wb-badge">read-only</span>}
              </button>
            </li>
          ))}
        </ul>
        {chosen && (
          <>
            <p className="wb-hint">{chosen.description.slice(0, 260)}</p>
            <div className="wb-row">
              <input className="wb-input" aria-label="Arguments as JSON" value={args} spellCheck={false} onChange={(e) => setArgs(e.target.value)} />
              <button className="wb-button" onClick={call}>
                Call {chosen.name}
              </button>
            </div>
          </>
        )}
        {output && <pre className={`st-conn-output ${output.ok ? "" : "wb-warn"}`}>{output.text.slice(0, 4000)}</pre>}
      </section>
    );
  }
  return (
    <p className="wb-hint">
      Query it from a SQL console:{" "}
      <button className="st-linkish" onClick={() => void wb.run("panel.open", { toolId: "sql", state: { connection: connection.id } })}>
        open one on this connection
      </button>
    </p>
  );
}

function Connections() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const list = useSyncExternalStore(store.subscribe, store.list);
  const bridge = useMeta((meta) => meta.bridge);
  // The names of the secrets in the app's .env file. Their values stay with the bridge.
  const secrets = useMeta((meta) => meta.home?.secrets) ?? [];
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = list.find((c) => c.id === state.selected) ?? null;
  const adding = state.selected === "new";
  const draft = (state.draft as Draft | null) ?? (selected ? toDraft(selected) : null);
  const dirty = state.draft !== null;
  const checked = draft ? check(draft) : null;
  const errors: Record<string, string> = dirty && checked && !checked.ok ? checked.errors : {};
  const edit = (patch: Record<string, string | boolean>) => draft && setState({ ...state, draft: { ...draft, ...patch } });
  const pick = (id: string | null) => (setSecret(""), setState({ selected: id, draft: null }));
  const start = (kind: Kind) => (setSecret(""), setState({ selected: "new", draft: toDraft(blank(kind)) }));

  const save = () => {
    if (!checked?.ok) return null;
    const saved = store.save(adding ? null : state.selected, checked.config, secret);
    setState({ selected: saved.id, draft: null });
    return saved;
  };
  const test = async () => {
    const target = dirty || adding ? save() : selected && (secret && store.save(selected.id, selected, secret), selected);
    if (!target) return;
    setBusy(true);
    await wb.run("connection.test", { id: target.id });
    setBusy(false);
  };

  const field = (name: string, label: string, input: React.ReactNode, hint?: string) => (
    <div className="wb-control" data-invalid={errors[name] ? true : undefined}>
      <label htmlFor={`conn-${name}`}>{label}</label>
      {input}
      {errors[name] ? <span className="wb-control-error" role="alert">{errors[name]}</span> : hint && <span className="wb-control-label">{hint}</span>}
    </div>
  );
  const text = (name: string, extra: object = {}) => (
    <input id={`conn-${name}`} className="wb-input" value={String(draft![name] ?? "")} aria-invalid={errors[name] ? true : undefined} spellCheck={false} onChange={(e) => edit({ [name]: e.target.value })} {...extra} />
  );
  const select = (name: string, options: [string, string][]) => (
    <Select id={`conn-${name}`} value={String(draft![name])} options={options.map(([value, label]) => ({ value, label }))} onChange={(value) => edit({ [name]: value })} />
  );
  const scope = field("scope", "Scope", select("scope", [["private", "Private (yours; usable by your custom elements)"], ["shared", "Shared (part of the app)"]]));

  return (
    <div className="st-conn">
      <aside className="st-conn-list">
        <Select aria-label="New connection" placeholder="New connection…" value="" options={(Object.keys(KINDS) as Kind[]).map((kind) => ({ value: kind, label: KINDS[kind] }))} onChange={start} />
        {list.map((c) => (
          <button
            key={c.id}
            className="wb-list-item"
            aria-current={c.id === state.selected || undefined}
            onClick={() => pick(c.id)}
            onContextMenu={(e) =>
              openContextMenu(wb, e, [
                { label: "Test connection", run: () => void wb.run("connection.test", { id: c.id }) },
                c.kind === "mssql" && { label: "Open a SQL console on it", disabled: c.status !== "ok", run: () => void wb.run("panel.open", { toolId: "sql", state: { connection: c.id } }) },
                { separator: true },
                { label: "Delete connection", danger: true, run: () => (store.remove(c.id), pick(null)) },
              ])
            }
          >
            <span className="st-conn-name">
              <span className="st-mark-status" data-status={c.status} aria-hidden />
              <span title={c.name}>{c.name}</span>
            </span>
            <span className="st-dim">{KINDS[c.kind]}</span>
          </button>
        ))}
        <p className="wb-hint st-conn-note">
          HTTP APIs and MCP servers are reached for real, through the app's bridge. SQL Server is simulated in this page: server{" "}
          <code>{SAMPLE_SERVER.host}</code>, databases <code>{SAMPLE_SERVER.databases.join(", ")}</code>, user <code>{SAMPLE_SERVER.user}</code>, password{" "}
          <code>{SAMPLE_SERVER.password}</code>.
        </p>
      </aside>
      {!draft ? (
        <p className="st-blank">Select a connection, or create one.</p>
      ) : (
        <div className="st-conn-detail">
          <form
            className="wb-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="wb-form-actions">
              <strong>{adding ? `New ${KINDS[draft.kind]} connection` : selected?.name}</strong>
              <span className="wb-badge">{KINDS[draft.kind]}</span>
              {dirty && <span className="wb-badge" data-tone="warn">unsaved changes</span>}
              {selected && !dirty && <span className="wb-badge" data-tone={selected.status === "ok" ? undefined : "warn"}>{STATUS[selected.status]}</span>}
            </div>
            {selected?.message && !dirty && (
              <p className={selected.status === "ok" ? "wb-hint" : "wb-hint wb-warn"} role="status">
                {selected.status === "ok" ? `Connected: ${selected.message}.` : selected.message}
              </p>
            )}
            {draft.kind !== "mssql" && bridge !== "connected" && (
              <p className="wb-hint wb-warn">This kind of connection goes through the agent bridge, which is not connected. Start it with `npm run dev`.</p>
            )}
            {field("name", "Name", text("name"))}

            {draft.kind === "mssql" && (
              <>
                <div className="wb-form-row">
                  {field("server", "Server", text("server", { placeholder: "host or host\\INSTANCE" }))}
                  {field("port", "Port", text("port", { inputMode: "numeric" }))}
                </div>
                {field("database", "Database", text("database"))}
                <div className="wb-form-row">
                  {field("auth", "Authentication", select("auth", [["sql", "SQL Server login"], ["windows", "Windows integrated"], ["entra", "Microsoft Entra ID"]]))}
                  {draft.auth === "sql" && field("user", "User", text("user", { autoComplete: "off" }))}
                </div>
              </>
            )}
            {draft.kind === "rest" && (
              <>
                {field("baseUrl", "Base address", text("baseUrl", { placeholder: "https://api.example.com" }))}
                <div className="wb-form-row">
                  {field("auth", "Authentication", select("auth", [["none", "None"], ["bearer", "Bearer token"], ["header", "Key in a header"]]))}
                  {draft.auth === "header" && field("headerName", "Header name", text("headerName", { placeholder: "X-API-Key" }))}
                </div>
                {field("testPath", "Path used to test the connection", text("testPath"), "A path that answers when the API is up, such as /health.")}
              </>
            )}
            {draft.kind === "mcp" && (
              <>
                {field("url", "Server address", text("url", { placeholder: "https://example.com/mcp" }), "An MCP server reachable over HTTP. Its tools become available to this app, its agents and your elements.")}
                {field("auth", "Authentication", select("auth", [["none", "None"], ["bearer", "Bearer token"]]))}
              </>
            )}

            {draft.kind !== "mssql" && draft.auth !== "none" && (
              <div className="wb-control">
                <label htmlFor="conn-secret">Where the {draft.kind === "rest" && draft.auth === "header" ? "key" : "token"} comes from</label>
                <Select
                  id="conn-secret"
                  value={String(draft.secret ?? "")}
                  options={[
                    { value: "", label: "Typed in here, for this session" },
                    ...secrets.map((s) => ({ value: s.name, label: s.name, hint: `for ${s.hosts.join(", ")}`, group: "From the app's .env file" })),
                    ...(draft.secret && !secrets.some((s) => s.name === draft.secret) ? [{ value: String(draft.secret), label: String(draft.secret), hint: "not in .env", group: "From the app's .env file" }] : []),
                  ]}
                  onChange={(value) => edit({ secret: value })}
                />
                <span className="wb-control-label">
                  {draft.secret
                    ? "The bridge attaches it to requests for the hosts listed with it. Its value never reaches this page."
                    : secrets.length
                      ? "Prefer a secret from .env: it is not typed again and never held by the page."
                      : "To avoid typing it each session, add it to the app's .env file as WERKBANK_SECRET_<NAME> with WERKBANK_SECRET_<NAME>_HOSTS (see Assistant setup)."}
                </span>
              </div>
            )}
            {needsSecret(draft) && (
              <div className="wb-control">
                <label htmlFor="conn-password">{SECRET[draft.kind]}</label>
                <input id="conn-password" className="wb-input" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={selected && store.hasSecret(selected.id) ? "entered for this session" : ""} />
                <span className="wb-control-label">Held in memory for this session only. It is never saved with the connection or the workspace.</span>
              </div>
            )}
            {draft.kind === "mssql" && (
              <div className="wb-form-row">
                <label className="wb-choice">
                  <input type="checkbox" checked={Boolean(draft.encrypt)} onChange={(e) => edit({ encrypt: e.target.checked })} />
                  Encrypt the connection
                </label>
                <label className="wb-choice">
                  <input type="checkbox" checked={Boolean(draft.trustServerCertificate)} onChange={(e) => edit({ trustServerCertificate: e.target.checked })} />
                  Trust server certificate
                </label>
              </div>
            )}
            {draft.kind === "mssql" ? (
              <div className="wb-form-row">
                {field("timeoutSeconds", "Timeout (seconds)", text("timeoutSeconds", { inputMode: "numeric" }))}
                {scope}
              </div>
            ) : (
              scope
            )}
            <div className="wb-form-actions">
              <button className="wb-button" type="submit" disabled={!dirty || !checked?.ok}>
                Save
              </button>
              <button className="wb-button" type="button" disabled={busy || (dirty && !checked?.ok)} onClick={() => void test()}>
                {busy ? "Testing…" : dirty || adding ? "Save and test" : "Test connection"}
              </button>
              {dirty && (
                <button className="wb-button" type="button" onClick={() => setState({ ...state, draft: null, selected: adding ? null : state.selected })}>
                  Discard changes
                </button>
              )}
              <span style={{ flex: 1 }} />
              {selected && (
                <button className="wb-button" type="button" onClick={() => (store.remove(selected.id), pick(null))}>
                  Delete
                </button>
              )}
            </div>
          </form>
          {selected && !dirty && selected.status === "ok" && <Explorer key={selected.id} connection={selected} />}
        </div>
      )}
    </div>
  );
}

export const connectionsTool = defineTool<State>({
  id: "connections",
  title: "Data connections",
  glyph: "⛁",
  category: "Data",
  version: 1,
  stateSchema,
  defaultState: () => ({ selected: "research", draft: null }),
  component: Connections,
  describe: () => ({
    note:
      "Outside sources this app can read. Kinds: SQL Server (simulated in the page), HTTP API and MCP server (both real, reached through the bridge). " +
      "Secrets are never stored or reported. Test one with connection.test; then use sql.query, api.get or mcp.call.",
    connections: store.list().map((c) => {
      const { id, name, kind, scope, status, message, testedAt } = c;
      const where = c.kind === "mssql" ? `${c.server}:${c.port}/${c.database}` : c.kind === "rest" ? c.baseUrl : c.url;
      return { id, name, kind, where, auth: c.auth, scope, status, message, testedAt, ...(c.kind === "mcp" ? { tools: store.toolsOf(id).map((t) => ({ name: t.name, readOnly: t.readOnly, description: t.description.slice(0, 160) })) } : {}) };
    }),
  }),
});
