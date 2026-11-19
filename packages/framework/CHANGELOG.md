# Changelog

## Unreleased

Changes on `main` since the last release. This heading becomes the version number when a release is tagged.

## 0.7.0

Changed, and needs attention in an existing app
- Every app has an agent bridge of its own: one process, one port, one folder. A bridge that finds another app's bridge on its port stops and says which port to set, instead of joining it; apps no longer share one. The port is `BRIDGE_PORT`, or `"werkbank": { "bridgePort": … }` in the app's `package.json`, or 8787. The bridge and `bridgeProxy()` read the same value. New apps get the app's port plus 3000 (`npm run new:app -- <folder> "Title" --port 5300` gives the bridge 8300); the starter uses 8199. An app that is the only one running needs no change. See "To adopt in an existing app" below.
- In the palette, "Open X" goes to X's panel when one is open, as the Tools view does (the new command `panel.show`); "Open another X" is offered for tools that are open. `panel.open` itself is unchanged for commands and agents.

Added
- Workspaces, settings and custom elements on disk: with the app's folder known to the bridge, what the app stores under its own name is also kept in `.werkbank/app-data.json` there (`wb.files`, a `MirroredStore`). The newer value wins key by key, and a browser that holds nothing of the app starts from the file. The setting *Keep workspaces, settings and custom elements in the app's folder* switches it off.
- Bridge service `http.request`: one request with a method (GET, POST, PUT, PATCH, DELETE) and a body, with the same rules for secrets as `http.get`. A command that uses it changes something elsewhere, so give it `risk: "external"`; it then waits for the person's approval when an agent runs it.
- `ownGroup` on a tool: its panel keeps a tab group to itself. No other panel can be stacked on it and it cannot be stacked on another, by a drag, a command or an agent; such a move lands beside the group instead. It can still be moved, split, maximised and popped out. `Werkbank.keepsOwnGroup(id)`.
- The Assistant panel: *Undo this change* under a reply takes back what the assistant changed while writing it; an empty conversation offers requests as buttons (`assistant.suggestions` in the config replaces the framework's own); *Attach a panel* sends a panel's data along with a message; the conversation list exports all conversations to a file, imports such a file, exports one as Markdown, and deletes all. Commands `conversation.deleteAll` and `conversation.import`; both can be undone.
- The tab a person is taken to lights up for a moment (`panel.focus`, a click on an open tool, "Open X" in the palette).
- The starter's HTTP API and MCP connections can name a secret from `.env` instead of asking for a token each session.
- A conversation store, `wb.conversations` (`ConversationStore`): the assistant's conversations are kept by the app under `<appId>.conversations` instead of in the Assistant panel's state. They survive the panel being closed, a workspace being replaced or reset and a reload; every Assistant panel and every tab of the app shows the same list; writes from several tabs are merged; a workspace file no longer contains them. Conversations held by a panel saved with an earlier version move into the store when that workspace is loaded or imported (the chat tool's state is version 4).
- Commands `conversation.list`, `conversation.rename` and `conversation.delete`; renaming and deleting can be undone.
- Conversations on disk: when the bridge knows the app's folder, the conversation store also keeps them in `.werkbank/conversations.json` there (private to the user, ignored by git), so they survive the browser's data being cleared, another browser and a change of address. The setting *Keep conversations in the app's folder* switches it off.
- Secrets from `.env`: `WERKBANK_SECRET_<NAME>` with `WERKBANK_SECRET_<NAME>_HOSTS` in the app's `.env` file. The app names a secret (`auth: { secret }` for `http.get`, `secret` for `mcp.tools` and `mcp.call`); the bridge attaches the value, only to the listed hosts, only over https (or to this machine), never along a redirect, and removes it from the answer. Values never reach the browser, an agent or a log. A file that others can read, that is a link, or that git could commit is not used. `Meta.home` (`HomeInfo`) gives the names.
- `@werkbank/bridge/vite`: `bridgeProxy()` for an app's Vite config. It forwards the page's connection and tells the bridge which folder the app lives in; without it an app has neither the file store nor secrets. Bridge services `home.info`, `store.read`, `store.write`.
- The Assistant setup window: a section *On this machine* (where conversations are kept, which secrets exist, what is wrong with `.env`), and a warning when the bridge in use is another version than the app, which happens when another Werkbank app started it first.
- New apps: `strictPort` (the browser keeps an app's data per address), `.env.example`, and `.env` and `.werkbank` in `.gitignore`. The development skill's rule check finds credentials in source, secrets in `VITE_` variables, and a `.env` that is readable by others or not ignored.
- The Assistant panel: a search field over conversations, other conversations can be read while one is being answered, a notice when a reply never arrived, and a notice when the browser's storage is full.

To adopt in an existing app:
- Replace the hand-written `/__bridge` entry in `vite.config.ts` with `proxy: bridgeProxy()` from `@werkbank/bridge/vite`, add `strictPort: true` beside the port, and add `.env`, `.env.*` and `.werkbank` to `.gitignore`. Until then the app works as before, with everything in the browser only.
- If more than one Werkbank app runs on the machine at a time, give each a bridge port of its own: `"werkbank": { "bridgePort": 8200 }` in its `package.json`. Agents registered by URL (`claude mcp add --transport http …`) need the new address; the *Assistant setup* window shows it.

Also changed
- A turn keeps writing to its conversation when its panel is closed. One turn runs at a time per page.
- While a reply streams in, only Assistant panels re-render and the write to storage is delayed, instead of the whole workspace document being saved for every piece.

Known limitations
- Unchanged from 0.6.1: the Codex adapter's success path has not been run. Claude Code is the tested agent.
- The browser checks now also run in CI, on Linux; they were written and run on macOS until this release.

## 0.6.2

Fixed
- An app installed from the release tarballs could not start its dev server: Vite's dependency pre-bundler failed on the chart libraries' `?raw` imports. New apps exclude `@werkbank/chart-libraries` from pre-bundling; an existing app adds `optimizeDeps: { exclude: ["@werkbank/chart-libraries"] }` to its `vite.config.ts`.
- The published packages no longer declare a `prepare` script, which referred to sources a tarball does not carry and made npm 11 warn on every install.

## 0.6.1

The first version published as a release.

Added
- A skill for coding agents that build apps, `skills/werkbank-app/` in the package: the order of work (backend, then frontend), patterns for stores, commands and panels, a rule check and a script for the dev processes. Scaffolded apps get it in `.claude/skills/`, with `npm run check:rules`, `dev:status` and `dev:stop`, and an `.mcp.json` for the app's bridge; `werkbank:update` refreshes it.
- Licences in the packages: each carries the MIT `LICENSE`; `@werkbank/chart-libraries` also carries the licence texts and notices of the libraries it redistributes (`vendor/licenses/`) and lists them in `THIRD-PARTY-NOTICES.md`.

Changed
- Clicking a tool in the Tools view goes to its panel when one is open (a dot marks such tools; with several open, repeated clicks walk through them) instead of opening another. Dragging a tool into the layout still opens a new panel, and `panel.open` is unchanged for commands, the palette and agents.
- `panel.focus` makes the panel's group the active one, restores the layout when another group is maximised, and brings a panel's own window forward. New: `Werkbank.openPanelOf(toolId)`.

Known limitations
- The Codex adapter for the in-app assistant was written from Codex's documented output format; only its start-up and error handling have been run. Claude Code is the tested agent.

## 0.6.0

First public version, under the name Werkbank.

- Packages: `@werkbank/framework`, `@werkbank/bridge`, `@werkbank/chart-libraries`. The bridge's command is `werkbank-bridge`.
- Code: `Werkbank`, `WerkbankConfig`, `useWerkbank`; styles in `@werkbank/framework/styles.css`.
- Agents: the MCP tools are `werkbank_describe`, `werkbank_commands`, `werkbank_run`, `werkbank_batch`, `werkbank_element_guide` and `werkbank_save_element`; resources start with `werkbank://`.
- Custom elements: the global object is `werkbank`.

Added
- `logo` in the app config: shown in the rail and the settings window. The name and logo are fixed by the app; a *Show the logo* setting lets a person hide it.
- Documentation in the settings window: the framework's pages, preceded by the app's own (`docs` in the config). Commands `docs.open` and `docs.list`; `settings.open` takes a `section`.
- `GUIDE.md` in the package: the guide for coding agents building an app.
- Releases as package tarballs, and `npm run werkbank:update` in scaffolded apps.

## 0.5.0

Added
- Settings: `settings` in the app config, a settings window, `useSetting`, and the `settings.set` command.
- Right-click menus: `openContextMenu`, with a menu on every tab.
- Assistant: a conversation overview, a choice of agent (the model stays in the agent's own configuration), and a setup window with per-agent connection commands and a briefing generated from the app's configuration (`assistant` in the config).
- Custom elements: the Crafter panel, a sandbox, `custom` in the app config (shipped elements, host functions, a submit hook), and the commands `custom.save`, `custom.delete`, `custom.submit`.
- `Command.undo` for commands that change the app's own data; preset workspaces; `keepAcrossWorkspaces` on a tool; tool categories.
- The element builder over MCP: tools `werkbank_element_guide` and `werkbank_save_element`, prompt `build_element`, resource `werkbank://elements`.
- Bridge outbound services (`http.get`, `mcp.tools`, `mcp.call`) and `bridgeService(wb, name, params)` so an app can reach HTTP APIs and other MCP servers.
- Assistant conversations can be renamed (double-click or right-click).
- Choice controls: `Select` (optionally `searchable`), `MultiSelect` and `SearchBox` (results with a preview). The shell and the starter use them everywhere; no native `<select>` or `<datalist>` is left.
- Libraries for custom elements: `custom.libraries` in the app config and `<script src="lib:NAME"></script>` in an element. `@werkbank/chart-libraries` packs ECharts, D3, Chart.js, Lightweight Charts and Plotly.
- The Crafter imports and exports elements as `.element.json` files.
- Fixed: a sandboxed element kept the previous theme's colours after a theme change.
- A built package with type declarations. Apps outside this repository consume `dist`.

Changed
- Whether the app connects to the agent bridge is now the setting `assistant.connect` (default on). The earlier browser-storage flag is no longer read.
- `Werkbank.describe` takes `{ detail, panels }`; `commands.describe` returns a compact index unless ids or `schemas` are given.
- The chat tool's state is version 3 (a list of conversations). Earlier state is migrated.

## 0.1.0

The first version: docking shell, workspace document, commands, linking, action history with undo, storage, themes, the agent bridge client.
