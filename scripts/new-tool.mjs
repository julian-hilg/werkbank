// Scaffold a tool in the starter: npm run new:tool -- <id> ["Title"]
// Creates starter/src/tools/<id>.tsx and registers it in starter/src/app.ts.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [id, titleArg] = process.argv.slice(2);
if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error('Usage: npm run new:tool -- <id> ["Title"]   (id: lowercase letters, digits, dashes)');
  process.exit(1);
}
const name = id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const Component = name[0].toUpperCase() + name.slice(1);
const title = titleArg ?? Component;
const file = `starter/src/tools/${id}.tsx`;
if (existsSync(file)) {
  console.error(`${file} already exists.`);
  process.exit(1);
}

writeFileSync(
  file,
  `import { defineTool, useLink, useToolState } from "@werkbank/framework";
import { z } from "zod";

// Private, persisted state of one panel. Bump \`version\` and add \`migrate\` when its shape changes.
const stateSchema = z.object({ note: z.string() });
type State = z.infer<typeof stateSchema>;

function ${Component}() {
  const [state, setState] = useToolState<State>();
  const [symbol] = useLink<string>("symbol");
  return (
    <div style={{ padding: 8 }}>
      <div className="wb-toolhead">
        <strong>{symbol ?? "no symbol"}</strong>
      </div>
      <input className="wb-input" value={state.note} aria-label="Note" onChange={(e) => setState({ note: e.target.value })} />
    </div>
  );
}

export const ${name} = defineTool<State>({
  id: "${id}",
  title: "${title}",
  version: 1,
  stateSchema,
  defaultState: () => ({ note: "" }),
  links: ["symbol"],
  component: ${Component},
  // What an agent sees instead of pixels: return the data behind the view.
  describe: (state, { links }) => ({ symbol: links.symbol ?? null, note: state.note }),
});
`,
);

const appFile = "starter/src/app.ts";
let app = readFileSync(appFile, "utf8");
const importLine = `import { ${name} } from "./tools/${id}";\n`;
const lastImport = app.lastIndexOf("\nimport ");
const lineEnd = app.indexOf("\n", lastImport + 1) + 1;
app = app.slice(0, lineEnd) + importLine + app.slice(lineEnd);
app = app.replace(/tools: \[([^\]]*)\]/, (_, list) => `tools: [${list.trim()}, ${name}]`);
writeFileSync(appFile, app);
console.log(`Created ${file} and registered "${id}" in ${appFile}.`);
