# Changelog

## Unreleased

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
