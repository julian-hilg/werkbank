---
name: werkbank-app
description: Builds and changes applications on the Werkbank framework (dockable panels that people and AI agents operate together), always in the order backend, then frontend - record schema, store and commands first, panels and workspaces second, then proof in the running app. Use when a project depends on @werkbank/framework or has a src/app.ts that creates a Werkbank; when adding or changing a panel (tool), command, store, topic, setting, workspace or documentation page of such an app; when starting, stopping or checking its dev server and agent bridge; or when updating it to a new Werkbank release. Not for custom elements built inside a running app with the Crafter, and not for changing the framework itself.
---

# Building a Werkbank app

The **app root** is the folder that holds `src/app.ts` (in a Werkbank checkout
that is `starter/`). The **guide** is the API reference and matches the
installed version: `node_modules/@werkbank/framework/GUIDE.md` (in a checkout:
`packages/framework/GUIDE.md`). Read the sections you need before writing code.
This skill is the order of work. Its two scripts are in `scripts/` next to this
file; an app made with `npm run new:app` has them as the npm scripts shown.

## Backend, then frontend

A Werkbank app has two halves, at run time and in the code.

| | Runs as | Code | May import |
| --- | --- | --- | --- |
| **Backend** | the agent bridge, `127.0.0.1:8787` | `src/<domain>/store.ts`, `commands.ts`, and what `src/app.ts` lists as `commands`, `topics`, `settings` | zod, types from `@werkbank/framework`. No React, no DOM |
| **Frontend** | the app's dev server | `src/<domain>/hooks.ts`, `src/tools/*.tsx`, and `tools`, workspaces and `docs` in `src/app.ts` | the backend, React, `@werkbank/framework` |

Build the backend first and finish it: **a feature is done in the backend when
an agent could do it with `werkbank_run` and read the result, with no panel on
screen.** Then the frontend only shows data and calls commands. A panel that
changes a store directly, or shows numbers that exist only in its DOM, is the
mistake this order prevents.

## The two processes

```
npm run dev:status    # is the app answering, is the bridge answering, who holds the ports
npm run dev:stop      # stop this app's dev server and bridge, and say what is left
```

(Without those npm scripts: `node <this skill>/scripts/dev.mjs status|stop [app folder]`.)

Start with `npm run dev` as a background task; it starts both. Check `status`
first and reuse what is running: a second copy takes another port and leaves a
stale one behind. One bridge serves every Werkbank app on the machine, so a
bridge started by another app is normal and `stop` leaves it running. Stop
what you started when you are finished.

## Workflow

1. **Orient.** Run `status`. Read `src/app.ts`: it lists every tool, command,
   topic and setting. Look for a store that already holds the data you need.
2. **Backend.** Follow [backend.md](backend.md): one schema per record, a
   store that holds facts, derived numbers as functions, commands with an honest
   `risk` and an `undo`, then registration in `src/app.ts`.
3. **Frontend.** Follow [frontend.md](frontend.md): a hook on the store, one
   file per tool with `describe`, registration, a place in a workspace, a
   documentation page.
4. **Verify**, in this order; each step catches what the one before cannot.
   - `npm run typecheck` and `npm run build` (and `npm test` where there is one).
   - `npm run check:rules` (or `node <this skill>/scripts/check.mjs [app folder]`):
     the rules a compiler does not see.
   - In the running app, through the bridge's MCP tools (`.mcp.json` in the app
     registers them): `werkbank_describe` names the app you are connected to
     (with several apps open it is the tab used last), `werkbank_commands`
     lists the new command, `werkbank_run` performs it, `werkbank_describe`
     shows the result in the panel's data, `history.undo` reverses it. If the
     tools are missing, say so and verify on screen; do not skip the step silently.
   - On screen: use the feature, switch theme (Settings, Appearance), make the
     panel narrow.
5. **Report** what was built, what was verified and how, and anything not verified.

## Rules that do not bend

- Every action is a command; UI code calls `wb.run(id, input)`.
- Every panel returns the data behind its view from `describe`.
- Data lives in stores outside panels. Store facts, derive the rest.
- Never edit, patch or copy from `node_modules/@werkbank`; import only the
  packages' entry points. If the framework lacks something, build it in the app.
- Colours come from `--wb-*` tokens. Dropdowns and search fields are `Select`,
  `MultiSelect`, `SearchBox`. No Alt-key shortcuts.
- Ids are forever: `appId`, tool ids, command ids, setting keys. Saved
  workspaces and agents depend on them. Add, do not rename.
- Restoring a workspace triggers nothing: no fetch, no post.
- Simulated or sample data says so on screen.
- Do not commit unless asked.

## Other jobs

- **A new app:** in a Werkbank checkout, `npm run new:app -- <folder> "Title" --from release`,
  then `npm install` in it. Ask what the app is for before building panels.
- **A framework update:** `npm run werkbank:update`. If the type-check fails,
  the errors are what changed; `node_modules/@werkbank/framework/CHANGELOG.md`
  says how to adapt. It also refreshes this skill.
- **An HTTP API or another MCP server:** `bridgeService`, see [backend.md](backend.md).
