import { describe, expect, it } from "vitest";
import { applyDiff, diffCounts, diffLines, revertDiff, sideBySide, splitLines, unifiedDiff, type DiffLine } from "../src/diff/diff";
import { SAMPLE_AFTER, SAMPLE_BEFORE } from "../src/diff/sample";

const text = (...lines: string[]) => lines.join("\n") + "\n";
const kinds = (lines: DiffLine[]) => lines.map((l) => l.kind[0]).join("");

/** Line numbers on each side run 1, 2, 3, … without gaps. */
function expectConsecutive(lines: DiffLine[]) {
  const left = lines.filter((l) => l.kind !== "added").map((l) => l.left);
  const right = lines.filter((l) => l.kind !== "removed").map((l) => l.right);
  expect(left).toEqual(left.map((_, i) => i + 1));
  expect(right).toEqual(right.map((_, i) => i + 1));
  for (const l of lines) {
    if (l.kind === "added") expect(l.left).toBeUndefined();
    if (l.kind === "removed") expect(l.right).toBeUndefined();
  }
}

const PAIRS: [string, string][] = [
  [SAMPLE_BEFORE, SAMPLE_AFTER],
  [SAMPLE_AFTER, SAMPLE_BEFORE],
  ["", ""],
  ["", text("a", "b")],
  [text("a", "b"), ""],
  [text("a", "b", "c"), text("x", "y", "z")],
  [text("a", "b", "a", "b", "a"), text("b", "a", "b", "a", "b")],
  [text("same", "", "", "end"), text("same", "", "new", "", "end")],
  ["no final newline", "no final newline\nplus one"],
];

describe("line diff", () => {
  it("splits lines without inventing an empty last line", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb")).toEqual(["a", "b"]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
  });

  it("reports no changes for identical texts", () => {
    const lines = diffLines(SAMPLE_BEFORE, SAMPLE_BEFORE);
    expect(diffCounts(lines)).toEqual({ added: 0, removed: 0, same: splitLines(SAMPLE_BEFORE).length });
    expect(lines.every((l) => l.kind === "same" && l.left === l.right)).toBe(true);
    expect(unifiedDiff(lines)).toBe("");
    expect(diffLines("", "")).toEqual([]);
  });

  it("finds a pure insertion", () => {
    const lines = diffLines(text("a", "b", "c"), text("a", "b", "new", "c"));
    expect(kinds(lines)).toBe("ssas");
    expect(lines[2]).toEqual({ kind: "added", right: 3, text: "new" });
    expect(lines[3]).toEqual({ kind: "same", left: 3, right: 4, text: "c" });
  });

  it("finds a pure deletion", () => {
    const lines = diffLines(text("a", "b", "c"), text("a", "c"));
    expect(kinds(lines)).toBe("srs");
    expect(lines[1]).toEqual({ kind: "removed", left: 2, text: "b" });
    expect(lines[2]).toEqual({ kind: "same", left: 3, right: 2, text: "c" });
  });

  it("puts removed lines before added ones in a changed stretch", () => {
    expect(kinds(diffLines(text("a", "old", "z"), text("a", "new", "z")))).toBe("sras");
  });

  it("reproduces the right text when applied to the left, and the left when reverted", () => {
    for (const [before, after] of PAIRS) {
      const lines = diffLines(before, after);
      expect(applyDiff(lines)).toEqual(splitLines(after));
      expect(revertDiff(lines)).toEqual(splitLines(before));
      // Walking the left text by the recorded line numbers gives the same result.
      const left = splitLines(before);
      const rebuilt = lines.flatMap((l) => (l.kind === "removed" ? [] : l.kind === "same" ? [left[l.left! - 1]!] : [l.text]));
      expect(rebuilt).toEqual(splitLines(after));
    }
  });

  it("numbers lines consecutively on each side", () => {
    for (const [before, after] of PAIRS) expectConsecutive(diffLines(before, after));
  });

  it("keeps as many lines as a longest common subsequence allows", () => {
    expect(diffCounts(diffLines(text("a", "b", "c", "d", "e"), text("a", "c", "e", "b", "d"))).same).toBe(3);
    expect(diffCounts(diffLines(text("x", "a", "b", "c"), text("a", "b", "c", "x"))).same).toBe(3);
  });

  it("has a handful of each kind of change in the sample", () => {
    const counts = diffCounts(diffLines(SAMPLE_BEFORE, SAMPLE_AFTER));
    expect(counts.added).toBeGreaterThanOrEqual(4);
    expect(counts.removed).toBeGreaterThanOrEqual(4);
    expect(counts.same).toBeGreaterThanOrEqual(15);
  });
});

describe("side by side", () => {
  it("pairs a removed run with the added run that follows it", () => {
    const rows = sideBySide(diffLines(text("a", "old 1", "old 2", "old 3", "z"), text("a", "new 1", "new 2", "z")));
    expect(rows.map((r) => r.kind)).toEqual(["same", "changed", "changed", "removed", "same"]);
    expect(rows[1]).toEqual({ kind: "changed", left: { line: 2, text: "old 1" }, right: { line: 2, text: "new 1" } });
    expect(rows[3]).toEqual({ kind: "removed", left: { line: 4, text: "old 3" } });
    expect(rows[4]).toEqual({ kind: "same", left: { line: 5, text: "z" }, right: { line: 4, text: "z" } });
  });

  it("shows every line of both texts exactly once, in order", () => {
    for (const [before, after] of PAIRS) {
      const rows = sideBySide(diffLines(before, after));
      expect(rows.flatMap((r) => (r.left ? [r.left.text] : []))).toEqual(splitLines(before));
      expect(rows.flatMap((r) => (r.right ? [r.right.text] : []))).toEqual(splitLines(after));
    }
  });
});

describe("unified format", () => {
  it("writes headers, hunk ranges and prefixed lines", () => {
    const before = text("1", "2", "3", "4", "5", "6", "7", "8", "9", "10");
    const after = text("1", "2", "3", "4", "five", "6", "7", "8", "9", "10");
    expect(unifiedDiff(diffLines(before, after), { from: "a/f", to: "b/f" })).toBe(
      ["--- a/f", "+++ b/f", "@@ -2,7 +2,7 @@", " 2", " 3", " 4", "-5", "+five", " 6", " 7", " 8", ""].join("\n"),
    );
  });

  it("uses the empty-range convention for a new or emptied text", () => {
    expect(unifiedDiff(diffLines("", text("a", "b")))).toBe(["--- before", "+++ after", "@@ -0,0 +1,2 @@", "+a", "+b", ""].join("\n"));
    expect(unifiedDiff(diffLines(text("a"), ""))).toBe(["--- before", "+++ after", "@@ -1 +0,0 @@", "-a", ""].join("\n"));
  });

  it("splits distant changes into separate hunks whose ranges add up", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const after = [...before];
    after[2] = "changed 3";
    after.splice(25, 1);
    const out = unifiedDiff(diffLines(text(...before), text(...after)));
    const hunks = [...out.matchAll(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/gm)].map((m) => m.slice(1).map(Number));
    expect(hunks).toEqual([[1, 6, 1, 6], [23, 7, 23, 6]]);
    // Every hunk body has as many lines on each side as its header says.
    const bodies = out.split(/^@@.*@@\n/m).slice(1);
    bodies.forEach((body, i) => {
      const lines = body.split("\n").filter((l) => l !== "");
      expect(lines.filter((l) => !l.startsWith("+")).length).toBe(hunks[i]![1]);
      expect(lines.filter((l) => !l.startsWith("-")).length).toBe(hunks[i]![3]);
    });
  });
});
