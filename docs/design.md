# Design record

Written 16 November 2026. This records what was decided, why, and what is not
done. The research behind it was gathered on 15–16 November 2026; version
numbers and dates below are as of then.

## Goal

One frontend blueprint for many projects, mostly quantitative work: dense
panels (charts, tables, notes, logs) in a dockable layout with as little
permanent chrome as possible, usable by a person and by an AI agent alike.

## Decisions

| Question | Decision | Reason |
| --- | --- | --- |
| How projects reuse it | A shell package plus a starter that projects copy | Docking, storage, commands and linking should never diverge between projects; app code should be free to |
| Agent scope | Agent-ready shell plus an external bridge. A chat panel was added later; it routes through the bridge to an external agent | Keeps the model provider and its credentials out of the browser |
| Shell anatomy | Thin icon rail, one collapsible side dock, free dock tree in the centre | The bare-tree layout is a mode of it (zen); a menu bar would duplicate the command registry |
| Visual identity | Token themes; XP/7 default, modern dark and light included | One token sheet; a theme is a block of custom properties |
| Runtime | Browser first | Popouts are browser windows; a desktop wrapper can come later |
| Proof | A paper-trading desk of nine tools on a simulated live feed (first version: four static tools) | The trading lab is not touched and migrates later as its own project |
| Layout engine | react-resizable-panels `Workspace` (pinned to 4.24.0), behind one adapter | Chosen by the user over Dockview: headless, so every pixel of chrome is ours, and no paid tier |

## What the research established

**Agentic-era UI.** The question moved from "how do I talk to the model"
(2022–23) to "how do I verify what it did" (2025) to "how do I supervise
several agents cheaply and reversibly" (2026). The principles that became
architecture here:

1. One typed command registry serves people and agents
   ([VS Code contribution points](https://code.visualstudio.com/api/references/contribution-points),
   [Linear agent guidelines](https://linear.app/developers/aig),
   [WebMCP](https://developer.chrome.com/blog/webmcp-epp)).
2. The workspace stays primary; chat is at most one panel
   ([Linear](https://linear.app/now/design-for-the-ai-age),
   [NN/g](https://www.nngroup.com/articles/ai-paradigm/)).
3. Workspace state is one serialisable, validated document
   ([AG-UI shared state](https://docs.ag-ui.com/introduction)).
4. Reversibility and audit beat approval prompts: users approve 93% of
   permission prompts ([Anthropic](https://www.anthropic.com/engineering/claude-code-auto-mode)),
   so hard gates are kept for irreversible and external effects only.
5. The running UI must be legible without pixels: canvas charts and virtualised
   grids are invisible to an agent, so each tool returns its data from `describe`
   ([Playwright MCP](https://github.com/microsoft/playwright-mcp)).
6. One way to add a panel, enforced mechanically ([agents.md](https://agents.md/)).

**Docking gold standards.** Split/tab tree in the centre with collapsible edge
docks (VS Code, JetBrains, Zed); colour link groups with the last value retained
for late joiners (IBKR, thinkorswim, TradingView, [FDC3](https://fdc3.finos.org/docs/api/spec));
layout as data with named workspaces ([Rerun blueprints](https://rerun.io/docs/concepts/visualization/blueprints));
two zoom levels, maximise and zen (Blender, VS Code); popout by button, because
drag-out is unreliable in browsers; and caution with in-window floating panels,
which Figma tried and reverted ([UI3](https://www.figma.com/blog/our-approach-to-designing-ui3/)).
Minimal chrome in numbers: 22–28 px tab rows, a 20–24 px status bar, one header
per panel, close buttons on hover, empty docks at zero width, a density switch,
and labels kept.

Not confirmed from official sources: Bloomberg Launchpad, LSEG Workspace and
IBKR Desktop details, and the state of the field after June 2026.

## Architecture

```
packages/framework/src
  core/      no React. Workspace document, commands, linking, action log, storage
  layout/    the only importer of the layout library; implements LayoutEngine
  tools/     defineTool, the panel host with its error boundary, hooks for tools
  shell/     rail, side dock, tabs, palette, status bar, approval dialog
  themes/    one token sheet with three themes and two densities
  bridge-client.ts   the app's end of the agent bridge
```

Imports go one way: `shell → layout, tools → core`. Tests enforce it.

**Workspace document.** One versioned JSON document: the layout tree, the panel
instances (tool id, state version, private state, link group), the link groups'
last values, and shell settings. It is validated before use. Unknown tools and
orphan tabs are dropped with a notice; tool state is validated against the
tool's schema, migrated if the version differs, or reset. Storage keeps a
last-good copy and quarantines a rejected primary instead of overwriting it.
Limits: 48 panels, 512 kB.

**Tools.** `defineTool` is the only way to add a panel type. A tool declares its
state schema, default state, the link topics it uses, its component and a
`describe` function. Each open panel is an instance with its own id; ids are
never reused within a session.

**Linking.** Four colour groups. A linked panel reads and writes its group's
value per topic; an independent panel keeps its own. Leaving a group keeps the
values the panel was showing; joining an empty group seeds it with them.
Published values are validated against the topic's schema.

**Commands.** Every action is a command with an id, an input schema and a risk
class: `read`, `local`, `external`, `irreversible`. The palette, keybindings and
the agent bridge all read the registry. Closing a tab by any route is rerouted
through `panel.close`, so it is logged and undoable.

**Action history and undo.** Non-read commands are logged with the actor (user
or agent). Undo restores layout, links and the set of open panels to the point
before the action. A panel that exists both before and now keeps its current
state unless the undone action itself changed it, so undoing a layout change
never discards text typed since. There is no redo.

**Agent bridge.** A Node process that is an MCP server on stdio and a WebSocket
server on 127.0.0.1:8199, accepting only local origins. The app connects to it
when the person switches "agent" on in the status bar. Three tools:
`werkbank_describe`, `werkbank_commands`, `werkbank_run`. Agent commands run
through the same registry; `external` and `irreversible` ones wait for approval
in the app.

## The starter as a reference app

The starter is deliberately a small trading desk, because that exercises what
quantitative tools need from the shell: high-frequency updates, shared domain
state, derived numbers, and an action with consequences.

- **`market/feed.ts`** simulates a streaming feed: irregular quote and trade
  updates per symbol, a connection that drops and recovers, and channels tools
  subscribe to (`quote:SYMBOL`, `tape:SYMBOL`, `all`, `status`). It is the
  seam where a real feed goes.
- **`portfolio/ledger.ts`** stores fills only. Positions use the average-cost
  method; day P&L is today's equity minus the equity at the previous close.
  The account is long-only and cash-only.
- **Hidden panels do no work.** The layout suspends hidden tabs, which removes
  their feed subscriptions; nothing in the tools has to manage that.
- **The shell gained two things from this:** a `status` slot on `Shell` for
  app items in the status bar (the feed indicator), and building-block styles
  for stat tiles, form fields, segmented buttons and stale values.
- **Gain and loss are teal and orange-red, not green and red.** The original
  green/red pair failed a colour-vision separation check in all three themes
  (ΔE about 4 for deuteranopia; the target is 8). Gains and losses also always
  carry a sign or an arrow, so colour is never the only cue.

## The assistant panel and the bridge's roles

The chat panel (`tools/chat.tsx`, exported as `chatTool`) holds no model
client. A message travels: panel → the app's bridge connection → the bridge →
an agent process started for that turn → that agent's own copy of the bridge
(MCP) → back through the first bridge → the app's command registry.

- **Why route through an external agent** instead of calling a model API from
  the page: no API key in the browser, the agent of choice stays swappable
  (one adapter in `agents.js`), and the chat cannot do anything an external
  agent could not, because it is the same path.
- **Hub and peers.** Several copies of the bridge can now run at once: the
  first to get the port is the hub and holds the app connection; later ones
  (the chat agent's, or a second Claude Code session's) join as peers and
  forward through it. A peer takes over if the hub exits. A copy started by an
  agent exits when that agent closes its side.
- **Several app tabs.** Every open tab connects. A chat's agent is tied to
  the tab that started it (the bridge passes the tab's id to the agent's own
  bridge copy); an external agent acts on the tab used most recently. The first
  version allowed one tab and let a second one take over, which made two tabs
  disconnect each other in a loop once the app connected by itself.
- **The app connects by default.** The first version needed a Connect click;
  now the connection is on unless the person switches it off, and the panel
  switches it back on when a message is sent.
- **Same origin.** In development the app reaches the bridge through the dev
  server (`/__bridge`), so the browser sees one origin.
- **What the chat agent is allowed.** Claude Code is started with its built-in
  tools disabled and only the three Werkbank tools allowed. Its reach is the
  app's command registry, with the same approval gate as any agent.
- **This reverses an earlier decision** ("no in-app agent panels in version
  one"), at the user's request. The panel is a
  tool like any other, so apps that do not want it leave it out of `tools`.

Two core additions came with the non-trading example:

- **`Command.undo`.** A command that changes the app's own data can declare its
  inverse; undo then calls it. Without this, only workspace changes were
  undoable and every data edit would have had to be classed as needing approval.
- **Preset workspaces.** `presets` on the config are further ready-made
  workspaces, switchable from the palette and the Workspaces view.

## The MCP surface

The bridge's MCP side (`packages/bridge/src/mcp.js`) was rebuilt to use the
protocol's features rather than only tool calls. The choices:

- **Few tools, with discovery.** Four tools: describe, commands, run, batch.
  The alternative, one tool per app command, was rejected: this app has about
  fifty commands, and every schema would sit in the agent's context each turn.
  A compact index plus schemas on request keeps the fixed cost small and still
  gives the agent exact input schemas when it needs them.
- **State in layers.** `werkbank_describe` returns a summary (about 5 kB for
  eleven panels) unless panels are named; panel data is fetched per panel.
- **Resources and subscriptions.** The same state is addressable
  (`werkbank://panel/{id}` and four fixed URIs). The app tells the bridge what
  changed (workspace, a panel, the history; not live data ticks), debounced,
  and the bridge notifies only subscribers of those resources.
- **One result shape.** Every tool returns `{ ok, value }` or
  `{ ok, error, code }` as structured content with a declared output schema,
  and the same as text.
- **Annotations and instructions.** Tools state whether they are read-only;
  the server's instructions tell an agent how to approach the app.
- **Progress.** A command that stops for the person's approval reports that as
  an MCP progress notification, so the agent's client can show why it waits.
- **Prompts.** Three starting points a person can pick in their client.
- **Batch.** Several commands in one call, stopping at the first failure.

Not used, on purpose: sampling (the app has no reason to ask the agent's model
for text), and elicitation for approvals (the approval belongs in the app,
where the person sees what will change; an agent's client may not be visible).

Two fixes came out of testing with the real agent. A chat's conversation now
follows the person across workspaces (`keepAcrossWorkspaces` on a tool), since
an agent that switched preset used to wipe its own chat. And a running chat
turn retargets to the chat panel of the new workspace.

## An agent-agnostic assistant

The assistant no longer assumes one agent. Three decisions:

- **MCP by URL.** The bridge hub serves MCP over streamable HTTP on the same
  port as the app's WebSocket (`/mcp`). Claude Code, Codex and other clients
  register it with one command. Requests naming a non-local origin are
  refused, and the transport's DNS-rebinding protection is on. The stdio entry
  point remains for clients without HTTP support.
- **A setup window instead of a model picker.** It chooses the agent for the in-app
  panel from what is installed (the model stays the agent's own setting), and gives a person the command
  and a briefing for their own agent. The briefing is generated from the app's
  configuration (`assistant.brief`, its tools, topics and command groups), so
  it is specific to each app built on the framework.
- **Adapters for the in-app panel.** `agents.js` has adapters for Claude Code
  and Codex. The Codex adapter is written against Codex's documented
  `exec --json` events; on the development machine its start-up and failure
  handling were exercised, but no Codex turn completed, because the account
  there rejects every model tried, its configured default included. Treat the
  Codex success path as unverified until it has run on a working account.

## Settings: a window, not a panel

Settings are app-wide and occasional. As a panel they would be saved into
layouts, duplicated, and linked like data; as a window they stay out of the
workspace. Sub-apps add `SettingSpec`s; the control is chosen from the spec.
Changes go through `settings.set`, so they are logged, undoable and available
to agents, and a stored value that stops validating falls back to its default.

## Custom elements and the Crafter

The reasoning is in `docs/custom-elements.md`. The technical choices:

- **Sandbox.** A frame with `sandbox="allow-scripts"` (a unique origin) and a
  content policy of `default-src 'none'` with inline script and style only.
  The API is message-based and read-mostly; there is no way to run a command.
- **Elements are tools.** They are registered as tools (`c-<id>` personal,
  `e-<id>` shipped), so panels showing them persist, link and dock like any
  other. The "(C)" is part of the tool title.
- **The agent path is the ordinary one.** The Crafter sends a briefing through
  the same bridge and adapters as the assistant; the agent saves with the
  `custom.save` command. Nothing about building an element is privileged.
- **Host functions** are the app's explicit, reviewed extension of what
  elements may reach.

## Distribution

The framework package now has a build (`dist` with type declarations) because
an app outside this repository could not type-check against raw source: two
copies of React's types met. Inside the repository a package export condition
(`werkbank-source`) keeps the starter on live source.

## The gallery

The starter grew from a trading desk into a gallery of 28 panel types, because
the project's purpose is a blueprint for work applications in general. Three
things in the shell came out of it:

- **`Markdown`** is a shell component (used by the Document panel and by the
  assistant's replies). Raw HTML in the source is rendered as text.
- **Tool categories.** `category` on a tool groups the Tools view, which also
  gained a filter once the list passed a dozen entries.
- **Chart conventions** live in `starter/src/tools/lib.ts`: colour scales are
  built from theme tokens with CSS colour mixing (one hue for magnitude, the
  gain/loss pair around a neutral midpoint for polarity), so every chart
  follows the theme without its own palette. SVG export writes the computed
  colours into the file, since a standalone SVG cannot resolve the tokens.

Every panel follows the same contract, which is what makes the set usable by
an agent: persisted state behind a schema, shared context through link topics,
and a `describe` that returns the numbers behind the picture. The CAD part is
the clearest case: an agent reshapes it with one `panel.setState`, and the
schema refuses a dimension outside its limits.

## Where the build differs from the plan presented earlier

- **Edge docks.** The plan said left, right and bottom docks would be tabsets in
  the same tree. The layout library collapses a tabset to a header strip, not to
  zero width, which misses the "empty docks take no space" goal. The build has
  one left side dock owned by the shell, holding shell views (Tools, Workspaces,
  Action history), which collapses to nothing. A log or inspector at the bottom
  is an ordinary panel docked there.
- **Shell settings are not part of a workspace.** Loading or resetting a
  workspace keeps the current theme, density and side dock.

## Known limits

- **Browsers.** Verified in Chromium only. Safari and Firefox are untested. The
  layout library notes that Safari reloads iframes and drops focus when a tab
  moves, because it lacks `moveBefore`.
- **Touch** is untested.
- **Popout windows** are not restored as windows after a reload; their panels
  come back docked in the main window. A panel remounts when it moves between
  windows; its state is kept because it lives in the document, not in React.
- **Keyboard shortcuts do not work while focus is in a popout window.**
- **Layout library age.** The `Workspace` component first shipped on
  31 October 2026. It is pinned to an exact version and only `layout/DockArea.tsx`
  touches it; an upgrade means rerunning `npm run check`.
- **Undo** covers commands. Dragging a tab or resizing a split by hand is saved
  but not in the history.
- **The bridge accepts any page served from localhost**, and such a page can
  ask it to start the chat agent under your login. It is meant for a
  single-user development machine; do not expose its port.
- **Streaming depends on the model.** The bridge forwards each piece of text
  within 40 ms of Claude Code emitting it. Measured on 16 November 2026 with
  Claude Code 2.1.325: a reply with no tool call before it streams (a piece
  about every 50 ms); a reply that follows a tool call arrives in a single
  burst with the default model, Sonnet and Opus, and streams with Haiku.
  Disabling hooks and user settings did not change this, so it is upstream of
  this repository. The panel writes a burst out over about a second.
- **The chat has no markdown rendering.** The automated checks use a scripted
  stand-in agent; the real Claude Code path was run by hand (default model and
  Haiku, both answered correctly and acted on the app) and is not part of
  `npm run check`.
- **The Codex adapter's success path is unverified** (see above). Agents other
  than Claude Code and Codex need an adapter for the in-app panel, though any
  MCP client can connect by URL without one.
- **Secrets stay with the bridge.** A page that holds an API key has already
  leaked it: to the browser's storage, to extensions, and to any agent that can
  read the app. So an app names a secret and the bridge, which reads it from
  the app's `.env`, attaches it to the one request. Each secret carries the
  hosts it is for, because without that a page could ask the bridge to send
  any secret anywhere. The folder is named by the app's dev server rather than
  by the page for the same reason: a page must not be able to
  claim another app's folder.
- **One bridge per app.** A bridge holds its app's files and secrets, so apps
  do not share one: each has its own process and port, and a bridge that finds
  another app's bridge on its port stops instead of joining it. An earlier
  version let the first app's bridge serve all of them; that made every app
  depend on whichever version started first and needed extra care to keep
  folders apart. Several copies still run for one app (the dev server's, and
  one per agent session), the first as hub and the rest as peers.
- **The app's storage is kept twice as well.** Workspaces, settings and custom
  elements go to the browser and to one file in the app's folder; each key
  carries the time it was written and the newer value wins.
- **A tool can keep a tab group to itself** (`ownGroup`). The rule is one
  number: how many groups hold such a panel together with others. No change to
  the layout may raise it, whoever makes the change.
- **Conversations are kept twice.** The browser's copy makes the app work
  without a bridge; the file in the app's folder makes the conversations
  outlive the browser's data. Both hold the same format and are merged, newest
  copy of each conversation winning, so neither is the master.
- **Custom elements live in one browser.** There is no server-side store, and
  delivering a submission to a tracker is a hook each app must implement.
- **The MSSQL example is simulated in the page.** A real app runs the driver in
  its backend; the framework has no backend of its own.
- **No virtualised table or production chart component** ships in the shell. The
  starter's canvas chart and tables are examples sized for a few hundred rows.
- **Minute bars of past sessions are synthesised** from each daily bar (they
  reproduce its open, high, low, close and volume) and exist for the last five
  sessions only. The current session's minutes come from the live feed.
- **The simulated feed is not a market model.** Prices are a random walk, sped
  up so a session is watchable; there are no trading hours, and one "day" lasts
  as long as the page is open. The session P&L line joins across a feed outage
  with a straight segment instead of showing a gap.
- **Bundle:** see `npm run build` for current sizes; the map, the markdown
  renderer and the fine coastlines load on demand.

## Verification

`npm test` (116 unit tests across the core, the starter's domain logic and
the helper-built panels), `npm run typecheck`, and `npm run check`: 194 browser checks of the starter and 77 of the bridge through real MCP clients
(stdio and HTTP), including a sandbox probe that tries each forbidden thing, a
scripted agent building an element through the Crafter, and the setup window's
generated commands. A new app created with `npm run new:app` was installed,
type-checked, built and opened in a browser. Real runs through Claude Code
(not part of the automated checks): an assistant question over the URL
connection, and the Crafter building a working element from one sentence.

## Next steps, in the order I would take them

1. Port one real tool from the trading lab (the filing reader is already React)
   to find what the tool contract is missing.
2. Add the shared building blocks quant tools need: a virtualised data grid and
   a chart wrapper, both implementing `describe`.
3. Check Safari and Firefox.
4. Add a review surface for agent changes (keep or reject per change) once
   agents do more than single commands.
5. Render markdown in the assistant's replies.
