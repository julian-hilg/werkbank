# Building an app on the framework, and keeping it current

## Starting an app

```
npm run new:app -- ../my-app "My App" --from release
cd ../my-app && npm install && npm run dev
```

The new app owns four things: its tools (`src/tools/`), its definition
(`src/app.ts`: name, logo, commands, settings, documentation pages,
workspaces), its data services, and its stylesheet. Everything else is the
framework, which it depends on as packages:

| Package | What it is |
| --- | --- |
| `@werkbank/framework` | The shell, the core, the Assistant and Crafter panels, the controls, the theme sheet, and `GUIDE.md` for coding agents |
| `@werkbank/bridge` | The process that connects agents to the running app over MCP |
| `@werkbank/chart-libraries` | Chart libraries for sandboxed custom elements |

Where the packages come from is the `--from` option:

| | Dependencies point at | Use it for |
| --- | --- | --- |
| `--from release` | the tarballs of a GitHub release | a real project |
| `--from local` (default) | the folders of your Werkbank checkout | changing the framework and an app together |
| `--from <folder>` | tarballs written by `npm run pack` | testing a release before publishing it |

## How an update reaches an app

Because the shell, the controls, the assistant, the bridge and the in-app
documentation all live in the packages, an app gets improvements to them by
changing three dependency versions. Nothing is copied into the app, so there
is nothing to merge.

```
npm run werkbank:update            # the newest release
npm run werkbank:update -- 0.7.0   # a specific one
npm run werkbank:update -- --local ../werkbank   # link a checkout instead
```

The script (`scripts/werkbank.mjs` in the app) rewrites the dependencies,
installs, and type-checks the app. `npm run check:app` in this repository runs
that whole path against a freshly packed release on every push.

## What an update can and cannot change

The framework is versioned (`FRAMEWORK_VERSION`, and each package's
`version`). Its changelog is `packages/framework/CHANGELOG.md`.

Things that are stable across minor versions, and what protects them:

- **Saved workspaces.** The workspace document carries a schema number. A
  document that no longer validates is not discarded: the last good copy is
  used and the rejected one is kept. A schema change comes with a migration.
- **Panel state.** Each tool versions its own state and supplies `migrate`.
  State that fails its schema after an update is reset for that panel only,
  with a notice.
- **Settings.** A stored value that no longer passes its schema falls back to
  the setting's default.
- **Custom elements.** The element API (`ELEMENT_API` in the core) only gains
  calls within a major version. Submission packages record the framework
  version they were made with.
- **Commands and MCP tools.** Command ids and the MCP tool names are part
  of the public surface; agents and saved prompts depend on them.

Things an app should expect to adjust on a major version: the tool definition
fields, the shell's props, theme token names.

## Updating

1. `npm run werkbank:update`.
2. If the type-check fails, the errors are what the update changed. Read
   `node_modules/@werkbank/framework/CHANGELOG.md` between your version and the
   new one and adapt the app. Never edit the packages in `node_modules`.
3. Open the app with a workspace saved under the old version. Notices about
   repaired panels appear in the status bar.

What keeps an app updatable is listed in section 14 of the guide: import only
the packages' entry points, do not restyle `wb-*` classes or depend on the
shell's DOM, and keep your own tools' `version` and `migrate` correct.

## Changing the framework itself

In this repository the starter runs against the framework's source (a package
export condition, `werkbank-source`), so edits show immediately. Apps outside
it use the built output: run `npm run build:framework` after a change, and
`npm test`, `npm run typecheck` and `npm run check` before tagging a version.
