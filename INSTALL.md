# Installing Werkbank

There are two things you can install: the **reference app** (to look at what
Werkbank does), and **an app of your own** built on it.

## Requirements

| | |
|---|---|
| Node.js | 22 or newer, with npm |
| Browser | A current Chrome, Edge, Firefox or Safari |
| For the assistant | A coding agent on the same machine: [Claude Code](https://claude.com/claude-code) or Codex. Optional; the app works without one. |

## Run the reference app

```bash
git clone https://github.com/julian-hilg/werkbank.git
cd werkbank
npm install
npm run dev
```

Open http://localhost:5199. `npm run dev` starts two things: the app, and the
agent bridge on `127.0.0.1:8787` that lets the in-app assistant and your own
coding agent operate it. Everything in the reference app is simulated.

## Start an app of your own

From the Werkbank checkout:

```bash
npm run new:app -- ../my-app "My App" --from release
cd ../my-app
npm install
npm run dev          # http://localhost:5200
```

`--from release` makes the app depend on the published release of the
framework, so it stands on its own. Leave it out to link the app to your
checkout instead, which is what you want while changing the framework and an
app together.

The new app contains its definition (`src/app.ts`), one example panel, an
`AGENTS.md` for coding agents, and `npm run werkbank:update` for moving to a
newer framework version.

## Connect a coding agent to a running app

With the app open, click the star in the left rail (*Assistant setup*). It
shows whether the bridge is running, lets you choose the agent for the in-app
Assistant panel, and gives the one-line command that registers the app with
your own agent, for example:

```bash
claude mcp add --transport http werkbank-starter http://127.0.0.1:8787/mcp
```

The model an agent uses is set in that agent's own configuration, not in the app.

## Install with a coding agent

Paste one of these into your coding agent.

**To try the reference app:**

> Please clone `https://github.com/julian-hilg/werkbank.git`, run `npm install` in it, and start it with `npm run dev`. It needs Node.js 22 or newer; if that is missing, install it first. Check that http://localhost:5199 answers and that `curl http://127.0.0.1:8787/health` returns JSON naming `werkbank-bridge`. Then tell me the address to open, and how to connect you to the running app (the app's *Assistant setup* window gives the command).

**To start an app of my own on Werkbank:**

> Please create a new app on the Werkbank framework. Clone `https://github.com/julian-hilg/werkbank.git` next to where the app should live and run `npm install` in it. Then run `npm run new:app -- <path-to-my-app> "<App title>" --from release` there, and `npm install` in the new app. Before writing any code, read `AGENTS.md` in the new app and `node_modules/@werkbank/framework/GUIDE.md`, and follow them: every action is a command, every panel returns its data from `describe`, and the framework in `node_modules` is never edited. Start the app with `npm run dev`, confirm it opens at http://localhost:5200, and then ask me what the app is for before building panels.

**To update an app to the newest Werkbank:**

> Please update this app to the newest Werkbank release: run `npm run werkbank:update`. If the type-check it runs fails, read `node_modules/@werkbank/framework/CHANGELOG.md` for the versions in between and adapt the app's code; do not edit anything inside `node_modules`. Then start the app, open a workspace that was saved before the update, and tell me about any notices in the status bar.

## Updating

- **The reference app:** `git pull && npm install`.
- **An app of your own:** `npm run werkbank:update` in the app
  (`-- 0.7.0` for a specific version). See [docs/upgrading.md](docs/upgrading.md).

## Uninstalling

Delete the folder. The app keeps workspaces, settings and custom elements in
the browser's storage for its address; clear the site data for
`localhost:5199` (or `:5200`) to remove them.
