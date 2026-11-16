import { defineTool, useToolState } from "@werkbank/framework";
import { useMemo } from "react";
import { z } from "zod";
import { diffCounts, diffLines, sideBySide, unifiedDiff, type DiffKind, type SideCell } from "../diff/diff";
import { SAMPLE_AFTER, SAMPLE_BEFORE, SAMPLE_NAME } from "../diff/sample";
import { downloadText } from "./lib";

/** Longest text kept in the panel state, in characters. It also bounds the work of the diff. */
const MAX_CHARS = 4000;
const stateSchema = z.object({
  view: z.enum(["unified", "split"]),
  editing: z.boolean(),
  before: z.string().max(MAX_CHARS),
  after: z.string().max(MAX_CHARS),
});
type State = z.infer<typeof stateSchema>;

/** The gutter mark that says what happened to a line, so the tint is not the only sign. */
const MARK: Record<DiffKind, string> = { same: "", added: "+", removed: "−" };
const WORD: Record<DiffKind, string> = { same: "unchanged", added: "added", removed: "removed" };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Mark({ kind }: { kind: DiffKind }) {
  return (
    <td className="sx-diff-mark" aria-label={kind === "same" ? undefined : WORD[kind]}>
      {MARK[kind]}
    </td>
  );
}

/** One half of a side-by-side row: line number, mark and text, or a blank filler. */
function Side({ cell, kind }: { cell: SideCell | undefined; kind: DiffKind }) {
  if (!cell) return <td className="sx-diff-blank" colSpan={3} />;
  return (
    <>
      <td className="sx-diff-no" data-kind={kind}>{cell.line}</td>
      <Mark kind={kind} />
      <td className="sx-diff-text" data-kind={kind}>{cell.text || " "}</td>
    </>
  );
}

function Diff() {
  const [state, setState] = useToolState<State>();
  const lines = useMemo(() => diffLines(state.before, state.after), [state.before, state.after]);
  const rows = useMemo(() => (state.view === "split" ? sideBySide(lines) : []), [lines, state.view]);
  const counts = diffCounts(lines);
  const changed = counts.added + counts.removed > 0;
  const isSample = state.before === SAMPLE_BEFORE && state.after === SAMPLE_AFTER;
  const edit = (side: "before" | "after") => (e: React.ChangeEvent<HTMLTextAreaElement>) => setState({ ...state, [side]: e.target.value.slice(0, MAX_CHARS) });

  return (
    <div className="st-chart">
      <div className="wb-toolhead">
        <strong>Text diff</strong>
        <span className="wb-badge">sample data</span>
        <span className="wb-num">
          <span className="wb-up">+{counts.added} added</span>
          {"   "}
          <span className="wb-down">−{counts.removed} removed</span>
        </span>
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="View">
          {(["unified", "split"] as const).map((view) => (
            <button key={view} className="wb-button" aria-pressed={state.view === view} onClick={() => setState({ ...state, view })}>
              {view === "unified" ? "Unified" : "Side by side"}
            </button>
          ))}
        </span>
        <span className="wb-segment">
          <button className="wb-button" aria-pressed={state.editing} onClick={() => setState({ ...state, editing: !state.editing })}>
            Edit
          </button>
        </span>
        <button className="wb-button" title="Exchange the two texts" onClick={() => setState({ ...state, before: state.after, after: state.before })}>
          Swap
        </button>
        <button className="wb-button" disabled={isSample} title="Put the sample texts back" onClick={() => setState({ ...state, before: SAMPLE_BEFORE, after: SAMPLE_AFTER })}>
          Reset
        </button>
        <button
          className="wb-button"
          disabled={!changed}
          title="Save the changes in unified diff format"
          onClick={() => downloadText(`${SAMPLE_NAME}.diff`, unifiedDiff(lines, { from: `a/${SAMPLE_NAME}`, to: `b/${SAMPLE_NAME}` }), "text/x-diff")}
        >
          .diff
        </button>
      </div>
      <div className="st-readout wb-num">
        {changed
          ? `${plural(counts.added, "line")} added, ${counts.removed} removed, ${counts.same} unchanged   ${isSample ? "two versions of an invented config file" : "edited texts"}`
          : lines.length
            ? `The two texts are the same (${plural(lines.length, "line")}).`
            : "Both texts are empty. Choose Edit to type, or Reset for the sample."}
      </div>
      {state.editing && (
        <div className="sx-diff-edit">
          {(["before", "after"] as const).map((side) => (
            <label key={side}>
              <span>
                {side === "before" ? "Before" : "After"} <span className="st-dim wb-num">{state[side].length} / {MAX_CHARS}</span>
              </span>
              <textarea value={state[side]} maxLength={MAX_CHARS} spellCheck={false} wrap="off" aria-label={side === "before" ? "Text before" : "Text after"} onChange={edit(side)} />
            </label>
          ))}
        </div>
      )}
      <div className="sx-diff">
        {state.view === "unified" ? (
          <table className="sx-diff-table" aria-label="Unified diff of the two texts">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} data-kind={line.kind}>
                  <td className="sx-diff-no">{line.left ?? ""}</td>
                  <td className="sx-diff-no">{line.right ?? ""}</td>
                  <Mark kind={line.kind} />
                  <td className="sx-diff-text">{line.text || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="sx-diff-table" data-view="split" aria-label="Side-by-side diff of the two texts">
            <thead>
              <tr>
                <th colSpan={3}>Before</th>
                <th colSpan={3}>After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <Side cell={row.left} kind={row.kind === "same" ? "same" : "removed"} />
                  <Side cell={row.right} kind={row.kind === "same" ? "same" : "added"} />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export const diffTool = defineTool<State>({
  id: "diff",
  title: "Text diff",
  glyph: "±",
  category: "Showcase",
  version: 1,
  stateSchema,
  defaultState: () => ({ view: "unified", editing: false, before: SAMPLE_BEFORE, after: SAMPLE_AFTER }),
  component: Diff,
  describe: (state) => {
    const lines = diffLines(state.before, state.after);
    const counts = diffCounts(lines);
    return {
      note:
        state.before === SAMPLE_BEFORE && state.after === SAMPLE_AFTER
          ? "Sample data: two versions of an invented config file."
          : "The panel opens with sample data (two versions of an invented config file); these texts have since been edited in the panel.",
      view: state.view,
      editing: state.editing,
      counts: { added: counts.added, removed: counts.removed, unchanged: counts.same },
      lines: { before: lines.length - counts.added, after: lines.length - counts.removed },
      changes: lines.filter((l) => l.kind !== "same").map((l) => ({ kind: l.kind, line: l.kind === "added" ? l.right : l.left, side: l.kind === "added" ? "after" : "before", text: l.text })),
    };
  },
});
