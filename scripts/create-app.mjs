// Start a new app on Werkbank: npm run new:app -- <folder> ["App title"] [--from local|release|<folder of .tgz files>]
// It writes a small, runnable app that depends on the framework's packages.
// The app owns its tools, commands, settings and workspaces; the framework is a dependency it can update.
//   --from local    (default) link the packages from this checkout: for working on app and framework together
//   --from release  depend on the published release of this version on GitHub: for a real project
//   --from <dir>    depend on package tarballs in a folder (what `npm run pack` writes)
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const fromAt = args.indexOf("--from");
const from = fromAt >= 0 ? args.splice(fromAt, 2)[1] : "local";
const [folder, titleArg] = args;
if (!folder || !from) {
  console.error('Usage: npm run new:app -- <folder> ["App title"] [--from local|release|<folder of .tgz files>]');
  process.exit(1);
}
const target = resolve(folder);
if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`${target} exists and is not empty.`);
  process.exit(1);
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(repo, "packages", "framework", "package.json"), "utf8")).version;
const REPO_SLUG = "julian-hilg/werkbank";
// A linked app consumes the framework's built output, so make sure it exists.
if (from === "local" && !existsSync(join(repo, "packages", "framework", "dist", "index.js"))) {
  console.log("Building the framework first…");
  execSync("npm run build:framework", { cwd: repo, stdio: "inherit" });
}
const id = basename(target).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
const title = titleArg ?? id.replace(/(^|-)(\w)/g, (_, dash, c) => (dash ? " " : "") + c.toUpperCase());
const PACKAGES = ["framework", "bridge", "chart-libraries"];
const link = (pkg) =>
  from === "local"
    ? `file:${relative(target, join(repo, "packages", pkg)) || "."}`
    : from === "release"
      ? `https://github.com/${REPO_SLUG}/releases/download/v${VERSION}/werkbank-${pkg}-${VERSION}.tgz`
      : // An absolute path: a relative one breaks when either folder is reached through a symbolic link.
        `file:${join(resolve(from), `werkbank-${pkg}-${VERSION}.tgz`)}`;
if (from !== "local" && from !== "release" && !PACKAGES.every((pkg) => existsSync(join(resolve(from), `werkbank-${pkg}-${VERSION}.tgz`)))) {
  console.error(`${resolve(from)} does not hold the ${VERSION} package tarballs. Run "npm run pack" first.`);
  process.exit(1);
}

const files = {
  "package.json": JSON.stringify(
    {
      name: id,
      private: true,
      version: "0.1.0",
      type: "module",
      scripts: {
        dev: "node scripts/dev.mjs",
        "dev:app": "vite",
        bridge: "werkbank-bridge --hub",
        build: "vite build",
        typecheck: "tsc --noEmit",
        // Moves the app to another version of the framework. See scripts/werkbank.mjs.
        "werkbank:update": "node scripts/werkbank.mjs",
      },
      werkbank: { repo: REPO_SLUG },
      // The framework is a dependency. To update it, point these at a newer version and read its CHANGELOG.
      dependencies: { "@werkbank/framework": link("framework"), "@werkbank/bridge": link("bridge"), "@werkbank/chart-libraries": link("chart-libraries"), react: "^19.2.0", "react-dom": "^19.2.0", zod: "^4.6.7" },
      devDependencies: { "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", "@vitejs/plugin-react": "^6.3.0", typescript: "^5.9.0", vite: "^8.0.0" },
    },
    null,
    2,
  ),
  "tsconfig.json": JSON.stringify(
    { compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", strict: true, noEmit: true, skipLibCheck: true, noUncheckedIndexedAccess: true, lib: ["ES2023", "DOM", "DOM.Iterable"], types: ["vite/client"], paths: { react: ["./node_modules/@types/react"], "react/*": ["./node_modules/@types/react/*"], "react-dom": ["./node_modules/@types/react-dom"], "react-dom/*": ["./node_modules/@types/react-dom/*"] } }, include: ["src"] },
    null,
    2,
  ),
  "vite.config.ts": `import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // While the framework is linked from a folder (rather than installed from a registry or a git tag),
  // make sure the app and the framework share one copy of React.
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    port: 5200,
    // The app reaches the agent bridge through its own address.
    proxy: { "/__bridge": { target: "ws://127.0.0.1:8787", ws: true, rewriteWsOrigin: false } },
  },
});
`,
  "index.html": `<!doctype html>
<html lang="en" data-theme="xp" data-density="compact">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="data:," />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  "scripts/dev.mjs": `// Starts the app and the agent bridge together.
import { spawn } from "node:child_process";

const children = [spawn("npx", ["werkbank-bridge", "--hub"], { stdio: "inherit" }), spawn("npx", ["vite"], { stdio: "inherit" })];
const stop = () => children.forEach((child) => child.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach((child) => child.on("exit", (code) => (stop(), process.exit(code ?? 0))));
`,
  "src/main.tsx": `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "@werkbank/framework";
import "@werkbank/framework/styles.css";
import { werkbank } from "./app";

const bridgeUrl = \`\${location.protocol === "https:" ? "wss" : "ws"}://\${location.host}/__bridge\`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell werkbank={werkbank} bridgeUrl={bridgeUrl} />
  </StrictMode>,
);
`,
  "src/app.ts": `import { chartLibraries } from "@werkbank/chart-libraries";
import { Werkbank, chatTool, crafterTool } from "@werkbank/framework";
import { z } from "zod";
import { notes } from "./tools/notes";

/**
 * Everything that makes this app this app: its tools, the context panels can
 * share, its commands and settings, and the workspace a new user starts with.
 */
export const werkbank = new Werkbank({
  appId: "${id}",
  // The app's name and logo are set here, in code. Put the logo in public/ and name it below;
  // people can hide it under Settings → Appearance, but not change it.
  title: "${title}",
  // logo: "/logo.svg",
  version: "0.1.0",
  // Pages about this app for Settings → Documentation (markdown). The framework's own pages follow them.
  docs: [{ id: "app", title: "About ${title}", text: "# ${title}\\n\\nDescribe here what this app is for and how to use it." }],
  tools: [notes, chatTool, crafterTool],
  // Values panels in one link group share. Add a schema per topic.
  topics: { subject: z.string().nullable() },
  // Settings this app adds; they appear in the settings window.
  settings: [
    { key: "notes.wordGoal", title: "Word goal for a note", section: "Notes", description: "The note panel shows progress towards this.", schema: z.number().int().min(10).max(10_000), default: 200 },
  ],
  // Chart libraries that custom elements may load with <script src="lib:NAME"></script>.
  custom: { libraries: chartLibraries },
  // What an agent is told about this app when a person connects one.
  assistant: { brief: "Describe here what the app is for and what an agent should be careful with." },
  storage: localStorage,
  defaultWorkspace: {
    instances: [
      { id: "notes-1", toolId: "notes", link: "1" },
      { id: "chat-1", toolId: "chat" },
      { id: "crafter-1", toolId: "crafter" },
    ],
    layout: {
      root: {
        type: "split", id: "root", orientation: "horizontal",
        children: [
          { type: "tabset", id: "left", size: 55, tabs: [{ id: "notes-1" }] },
          { type: "tabset", id: "right", size: 45, tabs: [{ id: "chat-1" }, { id: "crafter-1" }] },
        ],
      },
    },
  },
});
`,
  "src/tools/notes.tsx": `import { defineTool, useSetting, useToolState } from "@werkbank/framework";
import { z } from "zod";

// One file per tool. This is the pattern for every panel: a state schema, a
// component, and a describe() that returns the data behind the view so an agent can read it.
const stateSchema = z.object({ text: z.string().max(20_000) });
type State = z.infer<typeof stateSchema>;
const words = (text: string) => text.trim().split(/\\s+/).filter(Boolean).length;

function Notes() {
  const [state, setState] = useToolState<State>();
  const [goal] = useSetting<number>("notes.wordGoal");
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="wb-toolhead">
        <strong>Notes</strong>
        <span>
          {words(state.text)} of {goal} words
        </span>
      </div>
      <textarea
        className="wb-input"
        style={{ flex: 1, border: 0, resize: "none", padding: 8 }}
        value={state.text}
        aria-label="Notes"
        placeholder="Write here. Ask the assistant to read or change it."
        onChange={(e) => setState({ text: e.target.value })}
      />
    </div>
  );
}

export const notes = defineTool<State>({
  id: "notes",
  title: "Notes",
  glyph: "✎",
  version: 1,
  stateSchema,
  defaultState: () => ({ text: "" }),
  component: Notes,
  describe: (state) => ({ text: state.text, words: words(state.text) }),
});
`,
  "AGENTS.md": `# ${title}

An app built on [Werkbank](https://github.com/${REPO_SLUG}): dockable workspaces that people and AI agents operate together.

**Before changing anything, read \`node_modules/@werkbank/framework/GUIDE.md\`.** It is the framework's guide for
coding agents and matches the installed version: how to add panels, commands, settings, forms, charts,
workspaces and documentation, and the rules that keep an app updatable.

## Commands

- \`npm run dev\`: the app at http://localhost:5200 and the agent bridge on port 8787
- \`npm run typecheck\`, \`npm run build\`
- \`npm run werkbank:update\`: move to the newest framework release (\`-- <version>\` for a specific one)

## Where things are

- \`src/app.ts\`: the app's identity (name, logo), tools, topics, commands, settings, documentation pages and workspaces
- \`src/tools/\`: one file per panel type
- \`public/\`: static files, including the logo

## Rules

- This app owns \`src/\`. The framework lives in \`node_modules/@werkbank\` and is never edited here: a framework
  update must be able to replace it. If the framework lacks something, build it in the app or propose it upstream.
- Import only from \`@werkbank/framework\`, \`@werkbank/framework/styles.css\`, \`@werkbank/bridge\` and \`@werkbank/chart-libraries\`,
  never from a path inside those packages.
- Colours come from the \`--wb-*\` theme tokens; no literal colours in components.
- Dropdowns and search fields are the framework's \`Select\`, \`MultiSelect\` and \`SearchBox\`, never native ones.
- Do not commit unless asked.
`,
  "scripts/werkbank.mjs": readFileSync(join(repo, "scripts", "app-update.mjs"), "utf8"),
  ".gitignore": "node_modules\ndist\n",
};

for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(target, path)), { recursive: true });
  writeFileSync(join(target, path), text);
}
console.log(`Created "${title}" in ${target}

Next:
  cd ${relative(process.cwd(), target) || "."}
  npm install
  npm run dev        # http://localhost:5200

The framework comes from ${from === "local" ? `this checkout (${repo})` : from === "release" ? `release v${VERSION} on GitHub` : resolve(from)}.
"npm run werkbank:update" in the app moves it to another version; docs/upgrading.md explains what an update can change.`);
