import { defineTool, useToolState } from "@werkbank/framework";
import { z } from "zod";

const stateSchema = z.object({ text: z.string().max(20_000) });
type State = z.infer<typeof stateSchema>;

function Notes() {
  const [state, setState] = useToolState<State>();
  return (
    <textarea
      className="st-notes"
      value={state.text}
      placeholder="Notes for this workspace. They are saved with the layout."
      aria-label="Notes"
      onChange={(e) => setState({ text: e.target.value })}
    />
  );
}

export const notes = defineTool<State>({
  id: "notes",
  title: "Notes",
  glyph: "✎",
  category: "Showcase",
  version: 1,
  stateSchema,
  defaultState: () => ({ text: "" }),
  component: Notes,
  describe: (state) => ({ text: state.text }),
});
