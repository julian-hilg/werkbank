import { Select, Markdown, defineTool, useToolState } from "@werkbank/framework";
import { z } from "zod";
import { LIBRARY } from "../docs/library";
import { downloadText } from "./lib";

const stateSchema = z.object({
  doc: z.string(),
  mode: z.enum(["read", "edit", "split"]),
  /** The person's own version of a document, where they changed it. */
  edits: z.record(z.string(), z.string().max(60_000)),
});
type State = z.infer<typeof stateSchema>;

const textOf = (state: State) => state.edits[state.doc] ?? LIBRARY[state.doc]?.text ?? "";
const headings = (text: string) =>
  text.split("\n").filter((line) => /^#{1,3} /.test(line)).map((line) => ({ level: line.match(/^#+/)![0].length, title: line.replace(/^#+ /, "") }));

function DocumentTool() {
  const [state, setState] = useToolState<State>();
  const text = textOf(state);
  const edited = state.doc in state.edits;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const editor = (
    <textarea
      className="st-doc-editor"
      value={text}
      spellCheck={false}
      aria-label="Markdown source"
      onChange={(e) => setState({ ...state, edits: { ...state.edits, [state.doc]: e.target.value } })}
    />
  );
  return (
    <div className="st-doc">
      <div className="wb-toolhead">
        <Select value={state.doc} aria-label="Document" options={Object.entries(LIBRARY).map(([value, d]) => ({ value, label: d.title, hint: value in state.edits ? "edited" : undefined }))} onChange={(doc) => setState({ ...state, doc })} />
        <span>{words} words</span>
        <span className="st-grow" />
        <span className="wb-segment" role="group" aria-label="Mode">
          {(["read", "split", "edit"] as const).map((mode) => (
            <button key={mode} className="wb-button" aria-pressed={state.mode === mode} onClick={() => setState({ ...state, mode })}>
              {mode === "read" ? "Read" : mode === "split" ? "Split" : "Edit"}
            </button>
          ))}
        </span>
        {edited && (
          <button
            className="wb-button"
            onClick={() => {
              const { [state.doc]: _dropped, ...edits } = state.edits;
              setState({ ...state, edits });
            }}
          >
            Revert
          </button>
        )}
        <button className="wb-button" onClick={() => downloadText(`${state.doc}.md`, text, "text/markdown")}>
          .md
        </button>
      </div>
      <div className="st-doc-body" data-mode={state.mode}>
        {state.mode !== "read" && editor}
        {state.mode !== "edit" && (
          <article className="st-doc-page">
            <Markdown text={text} />
          </article>
        )}
      </div>
    </div>
  );
}

export const documentTool = defineTool<State>({
  id: "document",
  title: "Document",
  glyph: "¶",
  category: "Showcase",
  version: 1,
  stateSchema,
  defaultState: () => ({ doc: "welcome", mode: "read", edits: {} }),
  component: DocumentTool,
  describe: (state) => ({
    document: state.doc,
    title: LIBRARY[state.doc]?.title ?? state.doc,
    mode: state.mode,
    edited: state.doc in state.edits,
    available: Object.fromEntries(Object.entries(LIBRARY).map(([id, d]) => [id, d.title])),
    outline: headings(textOf(state)),
    markdown: textOf(state),
    note: "To change the text, use panel.setState with a patch of { edits: { <document id>: <markdown> } }.",
  }),
});
