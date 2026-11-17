# Building an app on Werkbank: a guide for coding agents

This file ships inside `@werkbank/framework`, so it always matches the version
an app has installed (`node_modules/@werkbank/framework/GUIDE.md`). Read it
before changing an app built on Werkbank. Humans are welcome too.

## 1. What you are working with

Werkbank is a framework for **work applications made of dockable panels that
people and AI agents operate together**. An app is three things:

| Part | Where | Who owns it |
| --- | --- | --- |
| The framework | `node_modules/@werkbank/*` | Werkbank. Never edit it from an app. |
| The app definition | `src/app.ts` | The app: name, logo, tools, commands, settings, workspaces, docs |
| The panels | `src/tools/*.tsx`, plus the app's data stores | The app |

The packages:

- `@werkbank/framework`: the shell (rail, docks, tabs, palette, settings and
  setup windows), the core (workspace document, commands, linking, undo,
  settings, custom elements), the Assistant and Crafter panels, the controls
  and the theme sheet. Import from `@werkbank/framework` and
  `@werkbank/framework/styles.css` only, never from a path inside it.
- `@werkbank/bridge`: a local process (`werkbank-bridge`) that connects coding
  agents to the running app over MCP. The app does not import it.
- `@werkbank/chart-libraries`: chart libraries for sandboxed custom elements.

The one idea to keep in mind: **everything the app can do is a command, and
everything a panel shows is also available as data.** That is what lets an
agent use the app without looking at pixels. If you add a button that calls a
function directly, or a view whose numbers exist only in the DOM, you have
built something an agent cannot use. Add a command; return the data from
`describe`.

## 2. Commands for working on an app

```
npm run dev                # the app (http://localhost:5200) and the agent bridge (port 8787)
npm run dev:status         # what answers on those two ports, and which process holds them
npm run dev:stop           # stop this app's dev server and bridge
npm run typecheck
npm run build
npm run check:rules        # the rules of this guide that a compiler does not see
npm run werkbank:update    # move to the newest framework release; see section 14
```

**The order of work is backend, then frontend.** The backend of a feature is
its record schema, its store and its commands (sections 5, 6 and 8): plain
TypeScript without React, finished when an agent could do the task with no
panel on screen. The frontend is the panels that show that data and call those
commands (sections 4, 7 and 9). The package carries this order as a skill for
coding agents, `skills/werkbank-app/` next to this file: `SKILL.md` is the
workflow, `backend.md` and `frontend.md` hold the patterns to copy. A
scaffolded app has a copy in `.claude/skills/werkbank-app/`, where Claude Code
loads it by itself; `npm run werkbank:update` keeps it at the installed version.

Do not commit unless the person asks.

## 3. The app definition

`src/app.ts` creates one `Werkbank`. Every field:

```ts
import { chartLibraries } from "@werkbank/chart-libraries";
import { Werkbank, chatTool, crafterTool } from "@werkbank/framework";
import { z } from "zod";

export const werkbank = new Werkbank({
  appId: "ledger",                 // storage key prefix; never change it after release
  title: "Ledger",                 // the app's name: fixed here, not a setting
  logo: "/logo.svg",               // optional; a file in public/. People can hide it, not change it
  version: "1.2.0",                // the app's own version
  tools: [accounts, entryForm, chatTool, crafterTool],
  topics: { account: z.string().nullable() },      // shared context, validated
  commands: [...entryCommands],                    // app-wide actions
  settings: [...],                                 // section 8
  docs: [{ id: "ledger", title: "Using Ledger", text: "# …markdown…" }],   // section 11
  assistant: { serverName: "ledger", brief: "What the app is for and what an agent must be careful with." },
  custom: { libraries: chartLibraries, hostFunctions: {...}, elements: [...] },   // section 12
  storage: localStorage,
  defaultWorkspace: {...},                         // section 9
  presets: { Review: {...} },
});
```

`src/main.tsx` renders `<Shell werkbank={werkbank} bridgeUrl={…} status={…} />`
once. `status` is an optional React node for the status bar (a feed indicator,
a connection state).

## 4. Adding a panel type (a "tool")

One file per tool in `src/tools/`, added to `tools` in `src/app.ts`. There is
no other way to add a panel.

```tsx
import { defineTool, useLink, useToolState, useWerkbank } from "@werkbank/framework";
import { z } from "zod";
import { accounts, useAccounts } from "../data/accounts";

// 1. The panel's persisted state. Small, serialisable, validated.
const stateSchema = z.object({ sort: z.enum(["name", "balance"]) });
type State = z.infer<typeof stateSchema>;

function Accounts() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();        // saved with the workspace
  const [account, setAccount] = useLink<string | null>("account");   // shared with the link group
  const rows = useAccounts(state.sort);                    // data comes from a store, not from the panel
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="wb-toolhead">
        <strong>Accounts</strong>
        <button className="wb-button" onClick={() => void wb.run("entry.new", { account })}>New entry</button>
      </div>
      {/* … rows; clicking one calls setAccount(row.id) … */}
    </div>
  );
}

export const accountsTool = defineTool<State>({
  id: "accounts",                 // stable; saved workspaces refer to it
  title: "Accounts",
  glyph: "▤",                     // one character for lists
  category: "Ledger",             // heading in the Tools view
  version: 1,                     // bump when stateSchema changes shape…
  stateSchema,
  defaultState: () => ({ sort: "name" }),
  // migrate: (old, fromVersion) => …   …and supply this to carry old state over
  links: ["account"],             // topics it reads or sets
  component: Accounts,
  // 2. What an agent sees instead of pixels: the data behind the view.
  describe: (state, { links }) => ({ selected: links.account ?? null, sort: state.sort, rows: accounts.list(state.sort) }),
  commands: [],                   // commands that only make sense with this tool
});
```

Rules for tools:

- **State.** Persisted state goes through `useToolState`. Ephemeral UI state
  (hover, an open menu) may be `useState`. Never write to `localStorage`
  from a panel.
- **Data.** Domain data lives in stores outside the panels (plain classes with
  `subscribe`, read with `useSyncExternalStore`). A panel reads a store; it
  never owns the data. Two panels showing the same thing must agree.
- **Restoring is silent.** A panel must not fetch, post or trigger anything
  because it was restored from a saved workspace. Load in response to what is
  on screen.
- **`describe` is not optional in practice.** Return the rows, numbers and
  selection the view shows, in plain JSON, with units in the key names where it
  helps. Keep it bounded (cap long lists and say so). Never return secrets.
- **Layout.** The component fills its panel (`height: 100%`). Start with a
  `.wb-toolhead` bar for the title and controls.
- **Heavy views.** If a view pulls in a large library or data file, keep the
  tool definition in one file and the component in another loaded with
  `React.lazy`.

Hooks, all from `@werkbank/framework`:

| Hook | Gives |
| --- | --- |
| `useWerkbank()` | the `Werkbank`: `run`, `describe`, `settings`, `tools`, `config` |
| `useToolState<S>()` | `[state, setState]` for this panel, persisted |
| `useLink<T>(topic)` | `[value, setValue]` of a shared topic for this panel's link group |
| `useSetting<T>(key)` | `[value, setValue]` of an app setting |
| `useDoc(selector)` / `useMeta(selector)` | parts of the workspace document / app status (bridge state, action log) |
| `useInstanceId()` | this panel's id |

## 5. Shared context: topics and link groups

A topic is a named, validated value that panels in the same link group share:
the selected symbol, account, task, date range. Declare each in `topics` with a
zod schema; read and set it with `useLink`. Publishing a value the schema
rejects is refused. Do not invent a second mechanism (events, a global store)
for "the current selection".

## 6. Commands

A command is the only way to make something happen: for the person (palette,
keys, buttons, menus) and for an agent (MCP).

```ts
import type { Command, Werkbank } from "@werkbank/framework";

export const entryCommands: Command<Werkbank, any>[] = [
  {
    id: "entry.create",                 // "noun.verb", stable: agents and prompts depend on it
    title: "Create entry",
    category: "Ledger",
    risk: "local",
    input: z.object({ account: z.string(), amount: z.number().describe("In the account's currency") }),
    run: (_ctx, i: { account: string; amount: number }) => entries.create(i),   // return the result
    undo: (_ctx, _input, created) => void entries.remove((created as Entry).id),
  },
];
```

Choose `risk` honestly; it decides what an agent may do unasked:

| Risk | Meaning | Agent |
| --- | --- | --- |
| `read` | changes nothing | runs freely |
| `local` | changes the workspace or the app's own data **and can be undone** | runs freely; the person can undo it |
| `external` | has an effect outside the app (sends, orders, writes to a server) | waits for the person's approval |
| `irreversible` | cannot be undone | waits for the person's approval |

- A `local` command that changes the app's own data (not the workspace) must
  declare `undo`, which receives what `run` returned. Without an inverse it is
  not `local`.
- Describe every input field with `.describe()`: that text is the agent's
  documentation.
- Throw an `Error` with a sentence a person can act on; it becomes the result's
  `error`.
- `palette: false` hides a command from the palette (it still runs);
  `log: false` keeps pure view changes out of the action history; `keys: "mod+e"`
  binds a key (no Alt combinations); `when` hides and refuses a command;
  `expand` offers palette entries with the input already chosen.
- UI code calls `wb.run(id, input)` and gets `{ ok, value }` or
  `{ ok: false, error, code }`. It never calls the store directly for anything a
  command exists for.

Built-in commands cover panels (`panel.open`, `panel.close`, `panel.move`,
`panel.setState`, `panel.link`, `panel.popout` …), `link.publish`, views and
themes (`view.*`), workspaces (`workspace.*`), `history.undo`, `settings.set`,
`settings.open`, `docs.open`, `docs.list`, `assistant.setup` and custom elements
(`custom.*`). Do not add a second path that skips them.

## 7. Building the interface

**Styling.** Colours, fonts and sizes come from the theme tokens. A component
contains no literal colour. The tokens:

`--wb-canvas` (data areas), `--wb-canvas-alt`, `--wb-face` (controls),
`--wb-chrome` (frame), `--wb-text`, `--wb-text-dim`, `--wb-border`, `--wb-grid`
(rules in tables and charts), `--wb-accent`, `--wb-accent-text`, `--wb-hover`,
`--wb-good` / `--wb-bad` (gain and loss; chosen to be distinguishable with
colour-vision deficiency), `--wb-warn`, `--wb-radius`, `--wb-row-h`,
`--wb-font`, `--wb-mono`, `--wb-font-size`.

Ready-made classes: `wb-toolhead` (a panel's top bar), `wb-button`
(`data-tone="warn"`), `wb-input`, `wb-badge`, `wb-hint`, `wb-list-item`,
`wb-row`, `wb-segment`, `wb-num` (tabular numbers), `wb-up` / `wb-down`,
`wb-form`, `wb-form-row`, `wb-form-actions`, `wb-control`,
`wb-control-label`, `wb-control-error`. Put the app's own classes in the app's
stylesheet with its own prefix.

**Controls.** Use the framework's; they look the same in every browser and
theme:

```tsx
<Select value={v} options={[{ value: "a", label: "Alpha", hint: "3 items", group: "Greek" }]} onChange={setV} />
<Select searchable … />                       // type to filter; worth it from about ten options
<MultiSelect values={vs} options={…} onChange={setVs} />
<SearchBox items={items} onPick={pick} preview={(item) => <Preview item={item} />} />   // or search={(q) => fetch…}
```

Never use a native `<select>` or `<datalist>`. Also available: `Markdown`
(renders markdown safely), `openContextMenu(wb, event, items)` for right-click
menus (items run commands), `copyText`.

**Forms.** Keep what the person typed as strings in tool state, so a
half-filled form survives a reload. Validate the whole record with its one zod
schema on submit, show one message per field next to the field, and submit
through a command.

**Charts.** One axis per chart (never two y-scales). Sequential data in one
hue, gain/loss with `--wb-good` / `--wb-bad` around a neutral. Offer a hover
readout, and put the numbers in `describe`. Label simulated or sample data as
such on screen.

**Language.** Plain, specific text. Say what a control does, what went wrong
and what to do about it. No jargon the app's users would not use.

## 8. Settings

Values that belong to the person and the app rather than to one workspace:

```ts
settings: [
  { key: "ledger.currency", title: "Display currency", section: "Ledger", schema: z.enum(["EUR", "USD"]), default: "EUR",
    options: [{ value: "EUR", label: "Euro" }, { value: "USD", label: "US dollar" }], description: "Used for totals." },
]
```

They appear in the settings window under their `section`, with a control chosen
from the default's type (`control`, `options`, `suggestions` override it). Read
with `useSetting("ledger.currency")` or `wb.settings.get(key)`; agents change
them with `settings.set`. The app's **name and logo are not settings**: they
are fixed in the config. The framework adds one setting when a logo is
configured, *Show the logo*.

## 9. Workspaces

A workspace is the arrangement of panels plus their state and link groups.
`defaultWorkspace` is what a new user sees; `presets` are named alternatives.

```ts
defaultWorkspace: {
  links: { "1": { account: null } },
  instances: [
    { id: "accounts-1", toolId: "accounts", link: "1" },
    { id: "entry-1", toolId: "entry-form", link: "1", state: { /* optional initial state */ } },
    { id: "chat-1", toolId: "chat" },
  ],
  layout: {
    root: {
      type: "split", id: "root", orientation: "horizontal",
      children: [
        { type: "tabset", id: "left", size: 60, tabs: [{ id: "accounts-1" }] },
        { type: "tabset", id: "right", size: 40, tabs: [{ id: "entry-1" }, { id: "chat-1" }] },
      ],
    },
  },
}
```

Every instance id appears exactly once in the layout; sizes are percentages of
the parent split. People rearrange freely afterwards; their workspace is saved
in the browser and can be exported and imported as a file.

## 10. Agents

- The Assistant panel (`chatTool`) sends the person's message to a coding
  agent installed on their machine, through the bridge. The agent sees the
  app through six MCP tools: `werkbank_describe`, `werkbank_commands`,
  `werkbank_run`, `werkbank_batch`, `werkbank_element_guide`,
  `werkbank_save_element`.
- `assistant.brief` in the config is what an agent is told about this app.
  Write it: what the app is for, which data is real, what needs care.
- You do not write MCP code. Commands and `describe` are the whole integration.
  A good test of your work: could an agent complete the task using only
  `werkbank_describe` and `werkbank_run`?
- To let an app reach an HTTP API or another MCP server that a browser page
  cannot, call `bridgeService(wb, "http.get" | "mcp.tools" | "mcp.call", params)`.

## 11. Documentation inside the app

The settings window has a **Documentation** section. The framework supplies
pages about the workspace, the assistant, custom elements and keyboard
shortcuts. Add the app's own pages with `docs` in the config (markdown); they
are listed first. Write for the app's users: what the app is for, what each
workspace is for, where the data comes from. `docs.open` (with an optional
`page` id) opens it; `docs.list` lets an agent read the pages.

When you add a feature a user needs to know about, add or update a page.

## 12. Custom elements

People can build panels of their own inside the running app (the Crafter, or
any connected agent). These run in a sandbox with no network access and reach
the app only through a small API. As the app's developer you decide what they
may use:

- `custom.hostFunctions`: read-only functions elements may call
  (`werkbank.call(name, args)`). Describe each precisely. Keep them read-only.
- `custom.libraries`: chart libraries (`chartLibraries` gives ECharts, D3,
  Chart.js, Lightweight Charts and Plotly). Each loads only when used.
- `custom.elements`: elements that passed review and ship with the app.
- `custom.submit`: where a submission goes (a tracker, a pull request).

Elements must stay unable to run commands or reach the network. Do not add a
host function that writes.

## 13. Checklist before you say a change is done

1. `npm run typecheck` and `npm run build` pass.
2. You opened the app and used the feature. Type-checks are not acceptance for
   anything on screen.
3. Every new action is a command with an honest `risk`, described inputs, and
   an `undo` if it is `local` and touches app data.
4. Every new or changed view returns its data from `describe`.
5. State that must survive a reload is in `useToolState`; `version` was bumped
   and `migrate` written if a state schema changed shape.
6. No literal colours, no native dropdowns, no Alt-key shortcuts.
7. It works in every theme (switch in Settings → Appearance) and when the panel
   is narrow.
8. Simulated or sample data says so on screen.
9. The app's documentation pages mention what a user now needs to know.

## 14. Staying current with the framework

The framework is a dependency, so an app receives improvements to the shell,
the controls, the assistant and the agent bridge by updating, without merging
anything by hand:

```
npm run werkbank:update            # newest release
npm run werkbank:update -- 0.7.0   # a specific release
```

The script rewrites the three `@werkbank/*` dependencies, installs, refreshes
the development skill in `.claude/skills/werkbank-app/`, and type-checks the app. Then read `node_modules/@werkbank/framework/CHANGELOG.md`
for what changed.

What makes updates safe, and what you must not break:

- **Never edit, patch or copy code out of `node_modules/@werkbank`.** If the
  framework lacks something, build it in the app, or propose it upstream. A
  local fork cannot be updated.
- **Import only the packages' entry points.** Internal paths can change in any
  release.
- **Do not restyle framework classes** (`.wb-*`) from the app's stylesheet
  beyond what tokens allow, and do not depend on the shell's DOM structure.
- Saved workspaces, panel state and settings carry version numbers and are
  migrated or repaired by the framework; a panel whose saved state no longer
  fits its schema is reset on its own, with a notice. Keep your own tools'
  `version` and `migrate` correct so your users' workspaces survive your
  updates too.
- Command ids, MCP tool names and the element API only gain within a major
  version. Things that may change on a major version: tool definition fields,
  the shell's props, token names. The changelog lists them.

## 15. Where to look

- This guide and `CHANGELOG.md`, next to it in the package, and the
  development skill in `skills/werkbank-app/`.
- The type declarations in `node_modules/@werkbank/framework/dist` are the
  exact API; `WerkbankConfig`, `ToolSpec`, `Command` and `SettingSpec` are the
  ones to read.
- The framework's repository has a reference app (`starter/`) with some forty
  panels to copy from, and `docs/design.md` for the reasons behind the design.
