import { Select, defineTool, openContextMenu, copyText, useSetting, useToolState, useWerkbank } from "@werkbank/framework";
import { useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { TABLES, connections as store } from "../data/connections";
import type { QueryResult } from "../data/sql";
import { downloadCsv } from "./lib";

const stateSchema = z.object({
  connection: z.string().nullable(),
  sql: z.string().max(4000),
  history: z.array(z.string().max(4000)).max(12),
});
type State = z.infer<typeof stateSchema>;

const EXAMPLES = [
  "SELECT TOP 20 * FROM dbo.Orders WHERE symbol = 'DLTA' AND side = 'buy' ORDER BY qty DESC",
  "SELECT symbol, COUNT(*) AS orders, SUM(qty) AS shares FROM dbo.Orders GROUP BY symbol ORDER BY shares DESC",
  "SELECT symbol, sector, value, unrealised FROM dbo.Positions ORDER BY value DESC",
  "SELECT owner, COUNT(*) AS open_tasks FROM dbo.Tasks WHERE status <> 'done' GROUP BY owner",
];

function SqlConsole() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const list = useSyncExternalStore(store.subscribe, store.list);
  const [limit] = useSetting<string>("data.rowLimit");
  const [result, setResult] = useState<(QueryResult & { ms: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connection = list.find((c) => c.id === state.connection) ?? null;

  const run = async (sql = state.sql) => {
    if (!connection) return setError("Choose a connection.");
    const started = performance.now();
    const outcome = await wb.run("sql.query", { connection: connection.id, sql });
    if (!outcome.ok) return (setResult(null), setError(outcome.error));
    setError(null);
    setResult({ ...(outcome.value as QueryResult), ms: Math.round(performance.now() - started) });
    setState({ ...state, sql, history: [sql, ...state.history.filter((h) => h !== sql)].slice(0, 12) });
  };

  return (
    <div className="st-sql">
      <div className="wb-toolhead">
        <Select aria-label="Connection" placeholder="Choose a connection" value={state.connection ?? ""} options={list.map((c) => ({ value: c.id, label: c.name, hint: c.status === "ok" ? undefined : c.status === "failed" ? "failed" : "not tested" }))} onChange={(connection) => setState({ ...state, connection })} />
        {connection && connection.status !== "ok" && (
          <button className="wb-button" onClick={() => void wb.run("connection.test", { id: connection.id })}>
            Test connection
          </button>
        )}
        <span className="wb-badge">read-only · simulated server</span>
        <span className="st-grow" />
        <Select
          aria-label="Examples and history"
          placeholder="Examples and history"
          searchable
          value=""
          options={[...EXAMPLES.map((q) => ({ value: q, label: q.slice(0, 70), group: "Examples" })), ...state.history.filter((q) => !EXAMPLES.includes(q)).map((q) => ({ value: q, label: q.slice(0, 70), group: "Recent" }))]}
          onChange={(sql) => setState({ ...state, sql })}
        />
        <button className="wb-button" onClick={() => void run()} title="Ctrl/⌘ Enter">
          Run
        </button>
        {result && (
          <button className="wb-button" onClick={() => downloadCsv("query.csv", result.columns, result.rows.map((r) => result.columns.map((c) => r[c])))}>
            CSV
          </button>
        )}
      </div>
      <div className="st-sql-top">
        <textarea
          className="st-sql-editor"
          spellCheck={false}
          aria-label="SQL"
          value={state.sql}
          onChange={(e) => setState({ ...state, sql: e.target.value })}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && (e.preventDefault(), void run())}
        />
        <nav className="st-sql-schema" aria-label="Tables">
          {TABLES.map((t) => (
            <details key={t.name}>
              <summary onDoubleClick={() => setState({ ...state, sql: `SELECT TOP 50 * FROM dbo.${t.name}` })}>dbo.{t.name}</summary>
              <ul>
                {t.columns.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          ))}
        </nav>
      </div>
      <div className="st-readout" role="status">
        {error ? <span className="wb-warn">{error}</span> : result ? `${result.rowCount.toLocaleString("en-US")} row${result.rowCount === 1 ? "" : "s"} in ${result.ms} ms${result.truncated ? `, first ${result.rows.length} shown (row limit ${limit})` : ""}` : "Ctrl/⌘ Enter runs the query. Double-click a table to select from it."}
      </div>
      <div className="st-sql-result">
        {result && (
          <table className="wb-table">
            <thead>
              <tr>
                {result.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr
                  key={i}
                  onContextMenu={(e) =>
                    openContextMenu(wb, e, [
                      { label: "Copy row as JSON", run: () => copyText(JSON.stringify(row)) },
                      { label: "Copy row as tab-separated", run: () => copyText(result.columns.map((c) => row[c]).join("\t")) },
                    ])
                  }
                >
                  {result.columns.map((c) => (
                    <td key={c}>{row[c] === null ? <span className="st-dim">NULL</span> : typeof row[c] === "number" ? (row[c] as number).toLocaleString("en-US", { maximumFractionDigits: 4 }) : String(row[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export const sqlTool = defineTool<State>({
  id: "sql",
  title: "SQL console",
  glyph: "⌗",
  category: "Data",
  version: 1,
  stateSchema,
  defaultState: () => ({ connection: "research", sql: EXAMPLES[1]!, history: [] }),
  component: SqlConsole,
  describe: (state) => ({
    connection: state.connection,
    sql: state.sql,
    note: "A read-only console on a simulated SQL Server holding the app's sample tables. Run queries with the sql.query command.",
    tables: TABLES.map((t) => ({ name: `dbo.${t.name}`, columns: t.columns })),
  }),
});
