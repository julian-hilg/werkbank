# Werkbank

A framework for dockable work applications that people and AI agents operate
together: the shell and core (`packages/framework`), an agent bridge
(`packages/bridge`), chart libraries for custom elements
(`packages/chart-libraries`) and a reference app (`starter/`).

- Working on Werkbank itself: this file and `DEVELOPMENT.md`.
- Building an app on Werkbank: `packages/framework/GUIDE.md`, and the
  `werkbank-app` skill in `packages/framework/skills/werkbank-app/` (backend
  first, then frontend). It also applies to work on the starter's own panels
  and stores.
- Why it is built this way: `docs/design.md`.

## Commands

- `npm run dev`: starter at http://localhost:5199 plus the agent bridge on port 8787
  (`npm run dev:app` for the app alone, `npm run bridge` for the bridge alone)
- `npm test`: unit tests for the core and the module boundaries
- `npm run check`: end-to-end checks in a real browser (needs `npm run dev` running)
- `npm run typecheck`, `npm run build`
- `npm run check:app`: a packed release installs, builds and updates in a fresh app
- `npm run new:tool -- <id> "Title"`: scaffold a tool in the starter
- `npm run skill:install`: install the `werkbank-app` skill for your own agent sessions

A change is done when `npm test`, `npm run typecheck` and `npm run check` pass.
Green unit tests alone are not acceptance for anything that touches the screen.

## Rules that are enforced by tests

- Only `packages/framework/src/layout/` imports `react-resizable-panels`.
- `core/` imports neither React nor any other module of the package.
- Components contain no literal colours; use the `--wb-*` tokens in
  `themes/werkbank.css`. A theme is one block of tokens.

## How to add things

- **A panel type:** one file with `defineTool` (see `starter/src/tools/`), added
  to `tools` in `starter/src/app.ts`. Keep persisted state in `useToolState`,
  shared context in `useLink`, and return the data behind the view from
  `describe` so agents can read it. There is no second way to add a panel.
- **An action:** a command (`Command` in `core/commands.ts`), passed in
  `commands` on the tool or the `Werkbank` config. Give it the right `risk`.
  The palette, keybindings and the agent bridge pick it up from the registry.
- **A shared context value:** add its schema to `topics` in the app config.
- **An action on the app's own data:** a `local` command with an `undo` that
  reverses it (see `starter/src/tasks/commands.ts`). Without an inverse it is
  not `local`.
- **A form:** keep what the user typed as strings in tool state, validate with
  the record's one schema, show one message per field (see `tools/task-form.tsx`).
- **A chart:** SVG sized with `useBox` (or canvas with `useCanvas`), colours
  from `sequential` / `diverging` in `starter/src/tools/lib.ts`, a hover
  readout, an export button, and the numbers in `describe`. One axis per chart.
- **An export:** `downloadCsv`, `downloadSvg`, `downloadCanvas` or
  `downloadText` from the same file.
- **A chat agent other than Claude Code:** an adapter in `packages/bridge/src/agents.js`.

## The starter's own rules

- Data and domain state live in stores outside the panels (`starter/src/market`,
  `starter/src/portfolio`); tools read them through hooks and never own them.
- Store facts, derive the rest. The ledger holds fills; positions and P&L are
  computed. Add a unit test for any new derived number.
- A price that is not updating is stale, not live. Dim and label it, and refuse
  actions that depend on it. Check `feed.isLive()`.
- Everything in the starter is simulated and says so on screen. Keep it that way.

## Things to leave alone

- Do not add a second path for closing, opening or moving panels that skips
  the command registry; the action history and undo depend on it.
- Restoring a workspace must never trigger a side effect in a tool. Tools load
  data in response to what is on screen, never in response to being restored.
- Do not commit unless asked. Commit messages are one short imperative line, with no generated footers or co-author lines.
- Do not break the public surface within a major version; see "Keeping apps updatable" in `DEVELOPMENT.md`. `npm run check:app` must keep passing.

## Framework or app?

`packages/framework` and `packages/bridge` are the framework; `starter/` is one
app built on it. A change belongs in the framework only if every app would want
it. After changing the framework run `npm run build:framework`: apps outside
this repository consume the built output. Note it in
`packages/framework/CHANGELOG.md`.

- **A setting:** a `SettingSpec` in the app's `settings` (see `starter/src/settings.ts`).
- **A right-click menu:** `openContextMenu(wb, event, items)` from an
  `onContextMenu` handler. Items run commands where one exists.
- **Something elements may call:** a read-only entry in `custom.hostFunctions`.
- Custom elements must stay unable to run commands or reach the network; the
  sandbox probe in `scripts/check.mjs` has to keep passing.

## Loading on demand

A tool whose view pulls in a large library or data file keeps its definition in
one file and its component in another, loaded with `React.lazy` (see
`starter/src/tools/map.tsx` and `map.view.tsx`). Check `npm run build` output
after adding a dependency.

## Driving the running app

`.mcp.json` registers the bridge as the `werkbank` MCP server. With the app
open, use `werkbank_describe` (summary first, then the panels you need),
`werkbank_commands`, `werkbank_run` and `werkbank_batch` instead of
screenshots. The MCP surface is defined in `packages/bridge/src/mcp.js`; a
change there needs `node scripts/check-bridge.mjs` to pass.

- **A dropdown or search field:** `Select`, `MultiSelect` or `SearchBox` from `@werkbank/framework`. Never a native `<select>` or `<datalist>`: their popups are drawn by the browser and differ per platform. `scripts/check.mjs` checks that none exists.
- **A chart library for elements:** an entry in `custom.libraries` (see `packages/chart-libraries`).
- **A page of in-app documentation:** the framework's pages are in `packages/framework/src/core/guide.ts`; an app's own go in `docs` in its config.
- **The app's name and logo:** `title` and `logo` in the app config. They are not settings.
