import { describe, expect, it } from "vitest";
import { ConnectionStore, SAMPLE_SERVER, blankConnection, mssqlSchema } from "../src/data/connections";
import { SqlError, runQuery, type Table } from "../src/data/sql";

const people: Table = {
  name: "People",
  columns: ["name", "team", "age", "active"],
  rows: () => [
    { name: "Ada", team: "red", age: 36, active: true },
    { name: "Ben", team: "blue", age: 29, active: true },
    { name: "Chen", team: "red", age: 41, active: false },
    { name: "Dana", team: "blue", age: 33, active: true },
    { name: "O'Hara", team: "red", age: null, active: true },
  ],
};
const q = (sql: string, limit?: number) => runQuery(sql, [people], limit);

describe("sample SQL engine", () => {
  it("selects columns, filters, orders and limits", () => {
    expect(q("SELECT name, age FROM dbo.People WHERE team = 'red' AND age > 30 ORDER BY age DESC").rows).toEqual([{ name: "Chen", age: 41 }, { name: "Ada", age: 36 }]);
    expect(q("select top 2 * from People order by name").rows.map((r) => r.name)).toEqual(["Ada", "Ben"]);
    expect(q("SELECT name FROM [dbo].[People] WHERE name LIKE '%a'").rows.map((r) => r.name)).toEqual(["Ada", "Dana", "O'Hara"]);
    expect(q("SELECT name FROM People WHERE name = 'O''Hara'").rows).toHaveLength(1);
    expect(q("SELECT name FROM People WHERE age IS NULL").rows).toEqual([{ name: "O'Hara" }]);
  });

  it("aggregates, with and without groups", () => {
    expect(q("SELECT COUNT(*) FROM People").rows).toEqual([{ count_rows: 5 }]);
    expect(q("SELECT team, COUNT(*) AS n, AVG(age) AS mean FROM People GROUP BY team ORDER BY team").rows).toEqual([
      { team: "blue", n: 2, mean: 31 },
      { team: "red", n: 3, mean: 38.5 },
    ]);
    expect(q("SELECT MAX(age), MIN(age), SUM(age) FROM People WHERE active = true").rows).toEqual([{ max_age: 36, min_age: 29, sum_age: 98 }]);
  });

  it("reports the row count and whether the result was cut", () => {
    const result = q("SELECT * FROM People", 2);
    expect(result).toMatchObject({ rowCount: 5, truncated: true });
    expect(result.rows).toHaveLength(2);
  });

  it("is read-only and explains mistakes", () => {
    expect(() => q("DELETE FROM People")).toThrow(/read-only/);
    expect(() => q("SELECT * FROM People; DROP TABLE People")).toThrow(/one statement/);
    expect(() => q("SELECT nope FROM People")).toThrow(/Unknown column "nope".*name, team, age, active/);
    expect(() => q("SELECT * FROM Nowhere")).toThrow(/Unknown table.*dbo.People/);
    expect(() => q("SELECT name, COUNT(*) FROM People GROUP BY team")).toThrow(/must be in GROUP BY/);
    expect(() => q("SELECT * FROM People WHERE team = red")).toThrow(SqlError);
  });
});

describe("connections", () => {
  const good = { ...blankConnection(), name: "Research", server: SAMPLE_SERVER.host, database: "Research", user: SAMPLE_SERVER.user };

  it("validates a connection's settings field by field", () => {
    const bad = mssqlSchema.safeParse({ ...blankConnection(), name: "x", server: "bad host!", port: 70000, timeoutSeconds: 0 });
    const fields = bad.error!.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["name", "server", "port", "database", "user", "timeoutSeconds"]));
    expect(mssqlSchema.safeParse({ ...good, auth: "windows", user: "" }).success).toBe(true);
  });

  it("never writes the password to storage", async () => {
    const written: string[] = [];
    const store = new ConnectionStore({ getItem: () => null, setItem: (_k, v) => void written.push(v) });
    const saved = store.save(null, good, SAMPLE_SERVER.password);
    await store.test(saved.id);
    expect(written.length).toBeGreaterThan(0);
    expect(written.join("")).not.toContain(SAMPLE_SERVER.password);
    expect(JSON.parse(written.at(-1)!).every((c: { status: string }) => c.status === "untested")).toBe(true);
  });

  it("tests a connection and reports why it failed", async () => {
    const store = new ConnectionStore(null);
    const ok = store.save(null, good, SAMPLE_SERVER.password);
    expect(await store.test(ok.id)).toMatchObject({ status: "ok" });
    const wrongPassword = store.save(null, { ...good, name: "Wrong password" }, "nope");
    expect(await store.test(wrongPassword.id)).toMatchObject({ status: "failed", message: "Login failed for user 'analyst'." });
    const noServer = store.save(null, { ...good, name: "No server", server: "sql-nowhere" }, "demo");
    expect((await store.test(noServer.id)).message).toMatch(/not found or was not accessible/);
    const noPassword = store.save(null, { ...good, name: "No password" });
    expect((await store.test(noPassword.id)).message).toMatch(/Enter the password/);
  });

  it("reaches HTTP APIs and MCP servers through whatever the app wires in, and keeps their secrets out of storage", async () => {
    const written: string[] = [];
    const calls: { service: string; params: any }[] = [];
    const store = new ConnectionStore({ getItem: () => null, setItem: (_k, v) => void written.push(v) });
    store.remote = async (service, params) => {
      calls.push({ service, params });
      if (service === "http.get") return { ok: true, value: (params as any).headers.authorization === "Bearer s3cret" ? { status: 200, ok: true, contentType: "application/json", body: { up: true } } : { status: 401, ok: false, contentType: "", body: "" } };
      if (service === "mcp.tools") return { ok: true, value: { server: "Other 1.0", tools: [{ name: "lookup", title: null, description: "Looks something up.", readOnly: true, inputSchema: {} }] } };
      return { ok: true, value: { isError: false, text: "42", structured: null } };
    };
    const api = store.save(null, { kind: "rest", name: "Prices API", baseUrl: "https://api.example.com/", auth: "bearer", headerName: "", testPath: "/health", scope: "private" });
    expect((await store.test(api.id)).message).toMatch(/Enter the token/);
    store.save(api.id, store.get(api.id)!, "wrong");
    expect((await store.test(api.id)).message).toMatch(/401: the credentials were not accepted/);
    store.save(api.id, store.get(api.id)!, "s3cret");
    expect(await store.test(api.id)).toMatchObject({ status: "ok", message: "HTTP 200, application/json" });
    expect(calls.at(-1)).toMatchObject({ service: "http.get", params: { url: "https://api.example.com/health" } });
    expect((await store.apiGet(api.id, "/v1/prices?symbol=X")).body).toEqual({ up: true });
    await expect(store.apiGet(api.id, "no-slash")).rejects.toThrow(/must start with/);

    const mcp = store.save(null, { kind: "mcp", name: "Other server", url: "https://other.example/mcp", auth: "none", scope: "shared" });
    await expect(store.mcpCall(mcp.id, "lookup", {})).rejects.toThrow(/has not been tested/);
    expect(await store.test(mcp.id)).toMatchObject({ status: "ok", message: "Other 1.0, 1 tool" });
    expect(store.toolsOf(mcp.id).map((t) => t.name)).toEqual(["lookup"]);
    expect((await store.mcpCall(mcp.id, "lookup", { q: 1 })).text).toBe("42");
    await expect(store.mcpCall(mcp.id, "nope", {})).rejects.toThrow(/no tool called "nope"/);
    expect(() => store.query(api.id, "SELECT 1", 10)).toThrow(/is a HTTP API connection, not a SQL Server one/);
    expect(written.join("")).not.toContain("s3cret");
    expect(() => store.save(null, { kind: "rest", name: "Bad", baseUrl: "ftp://x", auth: "header", headerName: "", testPath: "x", scope: "private" } as never)).toThrow();
  });

  it("refuses to query an untested connection, and a changed one is untested again", async () => {
    const store = new ConnectionStore(null);
    const c = store.save(null, good, SAMPLE_SERVER.password);
    expect(() => store.query(c.id, "SELECT COUNT(*) FROM dbo.Tasks", 100)).toThrow(/has not been tested/);
    await store.test(c.id);
    expect(store.query(c.id, "SELECT COUNT(*) AS n FROM dbo.Tasks", 100).rows[0]!.n).toBe(8);
    store.save(c.id, { ...good, timeoutSeconds: 30 });
    expect(store.get(c.id)!.status).toBe("untested");
  });
});
