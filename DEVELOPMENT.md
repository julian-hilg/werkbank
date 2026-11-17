# Development guide

For people and coding agents working on Werkbank itself. If you are building
an app *on* Werkbank, read [`packages/framework/GUIDE.md`](packages/framework/GUIDE.md) instead.

## Setup

```bash
npm install
npm run dev          # reference app at http://localhost:5199, agent bridge on 127.0.0.1:8787
```

Node.js 22 or newer. The repository is an npm workspace:

| Path | Package | Notes |
| --- | --- | --- |
| `packages/framework` | `@werkbank/framework` | TypeScript and React. Built to `dist` with declarations |
| `packages/bridge` | `@werkbank/bridge` | Plain Node.js (ES modules), no build step |
| `packages/chart-libraries` | `@werkbank/chart-libraries` | Copies library builds into `vendor/` on install |
| `starter/` | the reference app | Runs against the framework's source, so edits show at once |

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | App and bridge together (`dev:app` and `bridge` start one each) |
| `npm test` | Unit tests (vitest): the core, the module boundaries, the reference app's domain logic |
| `npm run typecheck` | All three TypeScript projects |
| `npm run check` | End-to-end checks in a real browser: the app, then the bridge through real MCP clients. Needs `npm run dev` running |
| `npm run check:app` | Packs a release, scaffolds an app from it in a temporary folder, installs, type-checks, builds and updates it |
| `npm run build` | Framework, then the reference app |
| `npm run build:framework` | Framework only. Run it after changing the framework: apps outside this repository use the built output |
| `npm run pack` | Writes the three package tarballs to `release/` |
| `npm run perf` | Frame pacing under the live feed, per workspace |
| `npm run new:tool -- <id> "Title"` | Scaffolds a panel in the reference app |
| `npm run new:app -- <folder> "Title"` | Scaffolds a new app (`--from release` to depend on the published release) |
| `npm run skill:install [-- <folder>]` | Copies the `werkbank-app` skill to `~/.claude/skills`, or to one app's `.claude/skills` |

A change is done when `npm test`, `npm run typecheck` and `npm run check` pass.
Unit tests alone are not acceptance for anything that touches the screen.

## How the code is laid out

```
packages/framework/src
  core/        React-free: workspace document, layout model, commands, storage, settings,
               custom elements, built-in commands, the in-app documentation
  layout/      the only module that imports the layout library
  shell/       the frame: rail, side views, palette, context menu, settings and setup windows
  tools/       the tool contract and hooks, Assistant, Crafter, Markdown, the sandbox
  controls/    Select, MultiSelect, SearchBox
  themes/      one stylesheet; a theme is one block of tokens
  bridge-client.ts   the app's side of the agent bridge
packages/bridge/src
  server.js    HTTP server: app WebSocket, MCP over HTTP, peers, health
  mcp.js       the MCP surface (tools, resources, prompts)
  agents.js    adapters that start a coding agent for the in-app assistant
  outbound.js  HTTP and MCP-client requests the app asks the bridge to make
```

Rules enforced by `packages/framework/test/boundaries.test.ts`:

- Only `layout/` imports `react-resizable-panels`.
- `core/` imports neither React nor any other module of the package.
- Components contain no literal colours.

[`docs/design.md`](docs/design.md) records the decisions and the reasons for them. Read
it before changing how commands, the workspace document or the bridge work.

## Framework or app?

A change belongs in the framework only if every app would want it. The
reference app is one app: its market feed, ledger, tasks and panels are
examples to copy, not framework features.

## Keeping apps updatable

Apps take framework changes by updating a dependency, so the public surface is
a promise. Within a major version:

- Do not remove or rename anything exported from `packages/framework/src/index.ts`,
  a field of `WerkbankConfig`, `ToolSpec`, `Command` or `SettingSpec`, a
  command id, an MCP tool name, a theme token, a `wb-*` class, or a call of the
  custom-element API. Add instead.
- A change to the workspace document needs a schema number and a migration; a
  document that no longer validates must be kept, not discarded.
- New config fields are optional and default to the previous behaviour.
- Record every user-visible change in `packages/framework/CHANGELOG.md`, and
  update `packages/framework/GUIDE.md` when the way to build something changes.
  The guide ships in the package, so apps always have the one for their version.
- `npm run check:app` must pass: it is the test that a release still works in
  an app that was not written in this repository.

## The skill for app developers

`packages/framework/skills/werkbank-app/` is a skill for coding agents that
build apps on Werkbank: the order of work (backend, then frontend), the
patterns to copy, a rule check and a script for the two dev processes. It is
kept in the package so it ships with every release; `.claude/skills/werkbank-app`
in this repository is a link to it, the scaffold copies it into each new app,
and `werkbank:update` refreshes that copy.

- It says how to work; `GUIDE.md` says what the API is. Do not repeat the
  guide in it, and change both when the way to build something changes.
- A rule added to `scripts/check.mjs` must pass on the starter and on a fresh
  app. `npm run check:app` runs it on one, and on a deliberately broken tool.

## Releasing

All three packages share one version.

1. Set the version in `packages/*/package.json`, the root `package.json` and
   `FRAMEWORK_VERSION` in `packages/framework/src/core/werkbank.ts`. A unit
   test fails if they disagree.
2. Move the changelog's entries under the new version.
3. Run `npm test`, `npm run typecheck`, `npm run check` (with `npm run dev`
   running) and `npm run check:app`.
4. Commit, then tag and push: `git tag v0.6.0 && git push --follow-tags`.

The `Release` workflow builds the tarballs and attaches them to a GitHub
release. Apps reach it with `npm run werkbank:update`.

## Conventions

- Commit messages: one short imperative line ("Add element import"). No
  generated footers or co-author lines.
- No Alt-key shortcuts: they collide with browser and system menus.
- Text on screen is plain and specific; errors say what happened and what to do.
- Everything in the reference app is simulated and says so on screen.
- The logo files are in `docs/brand/` (`generate.py` rebuilds the SVGs).
