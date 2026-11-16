import { Markdown, defineTool, useDoc, useToolState, useWerkbank } from "@werkbank/framework";
import { useMemo, useState } from "react";
import { z } from "zod";
import { buildReport } from "../report";
import { downloadText } from "./lib";

const stateSchema = z.object({
  /** Panels left out of the report. New panels are included by default. */
  excluded: z.array(z.string()),
  format: z.enum(["markdown", "json"]),
});
type State = z.infer<typeof stateSchema>;

function Export() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const instances = useDoc((doc) => doc.instances);
  const name = useDoc((doc) => doc.name);
  // The data is live, so the preview is rebuilt on request rather than on every tick.
  const [stamp, setStamp] = useState(0);
  const candidates = Object.values(instances).filter((i) => i.toolId !== "export" && i.toolId !== "chat");
  const included = candidates.filter((i) => !state.excluded.includes(i.id)).map((i) => i.id);
  const text = useMemo(() => buildReport(wb, included, state.format), [wb, included.join(","), state.format, stamp]);
  const toggle = (id: string) => setState({ ...state, excluded: state.excluded.includes(id) ? state.excluded.filter((x) => x !== id) : [...state.excluded, id] });
  return (
    <div className="st-export">
      <aside className="st-export-side">
        <strong>Panels in the report</strong>
        {candidates.map((i) => (
          <label key={i.id} className="wb-choice">
            <input type="checkbox" checked={!state.excluded.includes(i.id)} onChange={() => toggle(i.id)} />
            {wb.titleOf(i.id)} <span className="st-dim">{i.id}</span>
          </label>
        ))}
        <div className="wb-form-actions">
          <button className="wb-button" onClick={() => setState({ ...state, excluded: [] })}>
            All
          </button>
          <button className="wb-button" onClick={() => setState({ ...state, excluded: candidates.map((i) => i.id) })}>
            None
          </button>
        </div>
      </aside>
      <div className="st-export-main">
        <div className="wb-toolhead">
          <strong>Report</strong>
          <span>
            {included.length} panels · {(text.length / 1000).toFixed(1)} kB
          </span>
          <span className="st-grow" />
          <span className="wb-segment" role="group" aria-label="Format">
            {(["markdown", "json"] as const).map((format) => (
              <button key={format} className="wb-button" aria-pressed={state.format === format} onClick={() => setState({ ...state, format })}>
                {format === "markdown" ? "Markdown" : "JSON"}
              </button>
            ))}
          </span>
          <button className="wb-button" onClick={() => setStamp((n) => n + 1)}>
            Refresh
          </button>
          <button className="wb-button" onClick={() => void navigator.clipboard?.writeText(text)}>
            Copy
          </button>
          <button className="wb-button" onClick={() => downloadText(`${name}-report.${state.format === "markdown" ? "md" : "json"}`, text, state.format === "markdown" ? "text/markdown" : "application/json")}>
            Download
          </button>
        </div>
        <div className="st-doc-page">{state.format === "markdown" ? <Markdown text={text} /> : <pre className="st-pre">{text}</pre>}</div>
      </div>
    </div>
  );
}

export const exportTool = defineTool<State>({
  id: "export",
  title: "Report",
  glyph: "⇩",
  category: "Showcase",
  version: 1,
  stateSchema,
  defaultState: () => ({ excluded: [], format: "markdown" }),
  component: Export,
  describe: (state) => ({ format: state.format, excludedPanels: state.excluded, note: "Builds a report from what each panel reports about itself. The export.report command returns the same text." }),
});
