/** A line diff by longest common subsequence, and the shapes the Text diff panel draws from it. */

export type DiffKind = "same" | "added" | "removed";
export interface DiffLine {
  kind: DiffKind;
  /** Line number in the left text, from 1. Absent on an added line. */
  left?: number;
  /** Line number in the right text, from 1. Absent on a removed line. */
  right?: number;
  text: string;
}

/** Lines of a text. A final line break ends the last line and does not start an empty one. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * What turns `before` into `after`, line by line: the lines of a longest
 * common subsequence are "same", the rest of the left text is "removed" and
 * the rest of the right text is "added". Within a changed stretch the removed
 * lines come first.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  // Lines shared at both ends need no table.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const n = a.length - head - tail;
  const m = b.length - head - tail;

  // lcs[i][j]: length of the longest common subsequence of a[head+i..] and b[head+j..], stored row by row.
  const cols = m + 1;
  // The entries are at most min(n, m), so two bytes each are enough for all but enormous texts.
  const size = (n + 1) * cols;
  const lcs = Math.min(n, m) < 0xffff ? new Uint16Array(size) : new Uint32Array(size);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * cols + j] = a[head + i] === b[head + j] ? lcs[(i + 1) * cols + j + 1]! + 1 : Math.max(lcs[(i + 1) * cols + j]!, lcs[i * cols + j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  for (let k = 0; k < head; k++) out.push({ kind: "same", left: k + 1, right: k + 1, text: a[k]! });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[head + i] === b[head + j]) {
      out.push({ kind: "same", left: head + i + 1, right: head + j + 1, text: a[head + i]! });
      i++;
      j++;
    } else if (i < n && (j >= m || lcs[(i + 1) * cols + j]! >= lcs[i * cols + j + 1]!)) {
      out.push({ kind: "removed", left: head + i + 1, text: a[head + i]! });
      i++;
    } else {
      out.push({ kind: "added", right: head + j + 1, text: b[head + j]! });
      j++;
    }
  }
  for (let k = 0; k < tail; k++) out.push({ kind: "same", left: head + n + k + 1, right: head + m + k + 1, text: a[head + n + k]! });
  return out;
}

export function diffCounts(lines: DiffLine[]): { added: number; removed: number; same: number } {
  const counts = { added: 0, removed: 0, same: 0 };
  for (const line of lines) counts[line.kind]++;
  return counts;
}

/** The right text, rebuilt from the diff alone: every line that is not removed, in order. */
export const applyDiff = (lines: DiffLine[]): string[] => lines.filter((l) => l.kind !== "removed").map((l) => l.text);
/** The left text, rebuilt from the diff alone. */
export const revertDiff = (lines: DiffLine[]): string[] => lines.filter((l) => l.kind !== "added").map((l) => l.text);

// ---- side by side ---------------------------------------------------------------

export interface SideCell {
  line: number;
  text: string;
}
export interface SideRow {
  /** "changed": a removed line beside the added line that replaced it. */
  kind: "same" | "changed" | "added" | "removed";
  left?: SideCell;
  right?: SideCell;
}

/**
 * Rows for a side-by-side view. A run of removed lines followed directly by a
 * run of added lines is paired line for line; what is left over of the longer
 * run stands alone.
 */
export function sideBySide(lines: DiffLine[]): SideRow[] {
  const rows: SideRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "same") {
      rows.push({ kind: "same", left: { line: line.left!, text: line.text }, right: { line: line.right!, text: line.text } });
      i++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (lines[i]?.kind === "removed") removed.push(lines[i++]!);
    while (lines[i]?.kind === "added") added.push(lines[i++]!);
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      const [r, a] = [removed[k], added[k]];
      rows.push({
        kind: r && a ? "changed" : r ? "removed" : "added",
        ...(r ? { left: { line: r.left!, text: r.text } } : {}),
        ...(a ? { right: { line: a.right!, text: a.text } } : {}),
      });
    }
  }
  return rows;
}

// ---- unified format -------------------------------------------------------------

/**
 * The diff in standard unified format (what `diff -u` writes): a two-line
 * header, then hunks of changed lines with `context` unchanged lines around
 * them. Empty when nothing changed.
 */
export function unifiedDiff(lines: DiffLine[], options: { from?: string; to?: string; context?: number } = {}): string {
  const { from = "before", to = "after", context = 3 } = options;
  const changed = lines.map((l, i) => (l.kind === "same" ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return "";

  // Group changes whose context would touch or overlap into one hunk.
  const hunks: [number, number][] = [];
  for (const index of changed) {
    const last = hunks[hunks.length - 1];
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length - 1, index + context);
    if (last && start <= last[1] + 1) last[1] = end;
    else hunks.push([start, end]);
  }

  const out = [`--- ${from}`, `+++ ${to}`];
  // Line numbers reached so far on each side, for a hunk that has no line on one side.
  let leftSeen = 0;
  let rightSeen = 0;
  let cursor = 0;
  for (const [start, end] of hunks) {
    for (; cursor < start; cursor++) {
      if (lines[cursor]!.kind !== "added") leftSeen++;
      if (lines[cursor]!.kind !== "removed") rightSeen++;
    }
    const part = lines.slice(start, end + 1);
    const leftCount = part.filter((l) => l.kind !== "added").length;
    const rightCount = part.filter((l) => l.kind !== "removed").length;
    // By convention an empty range names the line before it.
    const range = (seen: number, count: number) => (count === 0 ? `${seen},0` : count === 1 ? `${seen + 1}` : `${seen + 1},${count}`);
    out.push(`@@ -${range(leftSeen, leftCount)} +${range(rightSeen, rightCount)} @@`);
    for (const line of part) out.push(`${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}${line.text}`);
  }
  return out.join("\n") + "\n";
}
