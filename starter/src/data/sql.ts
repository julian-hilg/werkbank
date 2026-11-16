/**
 * A small read-only SQL engine over the app's sample tables. It stands in for
 * a real database so the connection and query panels work without a server.
 * It understands enough T-SQL for the examples:
 *
 *   SELECT [TOP n] * | col, ... | COUNT(*), SUM(col), AVG(col), MIN(col), MAX(col)
 *   FROM table [WHERE a = 1 AND b LIKE 'x%' ...] [GROUP BY col] [ORDER BY col [DESC]]
 *
 * Anything that is not a single SELECT is refused.
 */
export type Row = Record<string, string | number | boolean | null>;
export interface Table {
  name: string;
  columns: string[];
  rows: () => Row[];
}
export interface QueryResult {
  columns: string[];
  rows: Row[];
  /** Rows the query matched, before any row limit was applied. */
  rowCount: number;
  truncated: boolean;
}

export class SqlError extends Error {}

const AGGREGATE = /^(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(\*|[\w.[\]]+)\s*\)(?:\s+AS\s+(\w+))?$/i;
const clean = (name: string) => name.replace(/[[\]]/g, "").replace(/^dbo\./i, "");

/** Split on a separator, ignoring separators inside quotes or brackets. */
function split(text: string, separator: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "'") quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    const rest = text.slice(i);
    const match = !quote && depth === 0 ? rest.match(separator) : null;
    if (match && match.index === 0) {
      out.push(current.trim());
      current = "";
      i += match[0].length - 1;
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function literal(text: string): string | number | boolean | null {
  const t = text.trim();
  if (/^'.*'$/s.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^null$/i.test(t)) return null;
  if (/^(true|false)$/i.test(t)) return /^true$/i.test(t);
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  throw new SqlError(`Expected a value but found "${t}". Text values need single quotes.`);
}

function condition(text: string, columns: string[]): (row: Row) => boolean {
  const match = text.match(/^([\w.[\]]+)\s*(<>|!=|<=|>=|=|<|>|\s+LIKE\s+|\s+IS\s+NOT\s+|\s+IS\s+)\s*(.+)$/is);
  if (!match) throw new SqlError(`Cannot read the condition "${text}".`);
  const column = columns.find((c) => c.toLowerCase() === clean(match[1]!).toLowerCase());
  if (!column) throw new SqlError(`Unknown column "${match[1]}" in WHERE. Columns: ${columns.join(", ")}.`);
  const op = match[2]!.trim().toUpperCase().replace(/\s+/g, " ");
  const value = literal(match[3]!);
  if (op === "LIKE") {
    const pattern = new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
    return (row) => pattern.test(String(row[column] ?? ""));
  }
  const same = (a: unknown) => (typeof a === "string" && typeof value === "string" ? a.toLowerCase() === value.toLowerCase() : a === value);
  if (op === "=" || op === "IS") return (row) => same(row[column]);
  if (op === "<>" || op === "!=" || op === "IS NOT") return (row) => !same(row[column]);
  // Comparisons with NULL are never true, as in SQL.
  const compare = (a: unknown): number => {
    if (a === null || a === undefined || value === null) return NaN;
    const [x, y] = [a as string | number, value as string | number];
    return x < y ? -1 : x > y ? 1 : 0;
  };
  if (op === "<") return (row) => compare(row[column]) < 0;
  if (op === ">") return (row) => compare(row[column]) > 0;
  if (op === "<=") return (row) => compare(row[column]) <= 0;
  return (row) => compare(row[column]) >= 0;
}

export function runQuery(sql: string, tables: Table[], limit = 500): QueryResult {
  const text = sql.trim().replace(/;\s*$/, "");
  if (!text) throw new SqlError("Enter a query.");
  if (text.includes(";")) throw new SqlError("Only one statement at a time.");
  if (!/^select\b/i.test(text)) throw new SqlError("This connection is read-only: only SELECT statements are allowed.");
  const parts = text.match(/^select\s+(?:top\s+\(?(\d+)\)?\s+)?(.+?)\s+from\s+([\w.[\]]+)(?:\s+where\s+(.+?))?(?:\s+group\s+by\s+([\w.[\]]+))?(?:\s+order\s+by\s+([\w.[\]]+)(?:\s+(asc|desc))?)?$/is);
  if (!parts) throw new SqlError("Cannot read that query. Supported: SELECT [TOP n] columns FROM table [WHERE ...] [GROUP BY column] [ORDER BY column [DESC]].");
  const [, top, select, from, where, groupBy, orderBy, direction] = parts;
  const table = tables.find((t) => t.name.toLowerCase() === clean(from!).toLowerCase());
  if (!table) throw new SqlError(`Unknown table "${from}". Tables: ${tables.map((t) => `dbo.${t.name}`).join(", ")}.`);
  const column = (name: string, where: string) => {
    const found = table.columns.find((c) => c.toLowerCase() === clean(name).toLowerCase());
    if (!found) throw new SqlError(`Unknown column "${name}" in ${where}. Columns of ${table.name}: ${table.columns.join(", ")}.`);
    return found;
  };

  let rows = table.rows();
  if (where) {
    const tests = split(where, /^\s+and\s+/i).map((c) => condition(c, table.columns));
    rows = rows.filter((row) => tests.every((test) => test(row)));
  }

  const items = split(select!, /^,/);
  const aggregates = items.map((item) => item.match(AGGREGATE));
  let columns: string[];
  if (aggregates.some(Boolean) || groupBy) {
    const key = groupBy ? column(groupBy, "GROUP BY") : null;
    const specs = items.map((item, i) => {
      const agg = aggregates[i];
      if (!agg) {
        const plain = column(item, "SELECT");
        if (plain !== key) throw new SqlError(`"${item}" must be in GROUP BY or inside an aggregate such as COUNT(*).`);
        return { name: plain, fn: null as string | null, of: plain };
      }
      const fn = agg[1]!.toUpperCase();
      const of = agg[2] === "*" ? "*" : column(agg[2]!, fn);
      if (of === "*" && fn !== "COUNT") throw new SqlError(`${fn}(*) is not valid; name a column.`);
      return { name: agg[3] ?? `${fn.toLowerCase()}_${of === "*" ? "rows" : of}`, fn, of };
    });
    const groups = new Map<unknown, Row[]>();
    for (const row of rows) {
      const k = key ? row[key] : "all";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(row);
    }
    if (!key && groups.size === 0) groups.set("all", []);
    columns = specs.map((s) => s.name);
    rows = [...groups.values()].map((members) =>
      Object.fromEntries(
        specs.map((s) => {
          if (!s.fn) return [s.name, members[0]?.[s.of] ?? null];
          if (s.fn === "COUNT") return [s.name, s.of === "*" ? members.length : members.filter((m) => m[s.of] !== null).length];
          const values = members.map((m) => m[s.of]).filter((v): v is number => typeof v === "number");
          if (values.length === 0) return [s.name, null];
          const sum = values.reduce((a, b) => a + b, 0);
          return [s.name, s.fn === "SUM" ? Math.round(sum * 100) / 100 : s.fn === "AVG" ? Math.round((sum / values.length) * 10000) / 10000 : s.fn === "MIN" ? Math.min(...values) : Math.max(...values)];
        }),
      ),
    );
  } else if (items.length === 1 && items[0] === "*") columns = table.columns;
  else {
    columns = items.map((item) => column(item, "SELECT"));
    rows = rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null])));
  }

  if (orderBy) {
    const by = columns.find((c) => c.toLowerCase() === clean(orderBy).toLowerCase());
    if (!by) throw new SqlError(`Cannot ORDER BY "${orderBy}": it is not in the result. Result columns: ${columns.join(", ")}.`);
    const sign = direction?.toLowerCase() === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => (a[by]! < b[by]! ? -sign : a[by]! > b[by]! ? sign : 0));
  }
  const rowCount = rows.length;
  const cap = Math.min(top ? Number(top) : Infinity, limit);
  return { columns, rows: rows.slice(0, cap), rowCount: top ? Math.min(rowCount, Number(top)) : rowCount, truncated: Math.min(rowCount, top ? Number(top) : Infinity) > limit };
}
