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
agent bridge on `127.0.0.1:8199` that lets the in-app assistant and your own
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
`AGENTS.md` and the `werkbank-app` skill for coding agents, an `.mcp.json`
that lets an agent started in the app's folder drive the running app, and
`npm run werkbank:update` for moving to a newer framework version.

## The skill for coding agents

`werkbank-app` is a skill that takes a coding agent through building a feature
in a fixed order: backend (schema, store, commands), then frontend (panels,
workspaces, documentation), then proof in the running app. It is what keeps
apps consistent with each other.

| Where you work | What to do |
| --- | --- |
| An app made with `npm run new:app` | Nothing. The skill is in `.claude/skills/werkbank-app/`; Claude Code loads it when you ask for a change to the app. Commit that folder with the app. |
| The Werkbank checkout | Nothing. `.claude/skills/werkbank-app` is in the repository. |
| Every project on your machine | `npm run skill:install` in the Werkbank checkout. It copies the skill to `~/.claude/skills/werkbank-app`. |
| An app that does not have it yet | `npm run skill:install -- ../my-app` in the Werkbank checkout, or `npm run werkbank:update` in the app. |

Start a new agent session afterwards. To check that it is there, ask the agent
"which skills do you have for Werkbank?", or type `/werkbank-app` in Claude Code.
Agents that do not load skills read the same files: the app's `AGENTS.md`
points to `.claude/skills/werkbank-app/SKILL.md`.

The skill also gives an app three commands that need no agent:

```bash
npm run check:rules   # rules a compiler does not see: literal colours, native dropdowns, panels without describe …
npm run dev:status    # what answers on the app's port and the bridge's, and which process holds them
npm run dev:stop      # stop this app's dev server and bridge
```

## Connect a coding agent to a running app

With the app open, click the star in the left rail (*Assistant setup*). It
shows whether the bridge is running, lets you choose the agent for the in-app
Assistant panel, and gives the one-line command that registers the app with
your own agent, for example:

```bash
claude mcp add --transport http werkbank-starter http://127.0.0.1:8199/mcp
```

The model an agent uses is set in that agent's own configuration, not in the app.

## Secrets and conversations

An app keeps two things in its own folder rather than in the browser.

**Secrets.** Copy `.env.example` to `.env`, make it yours alone, and add two lines per secret:

```bash
cp .env.example .env && chmod 600 .env
```

```
WERKBANK_SECRET_WEATHER=the-key
WERKBANK_SECRET_WEATHER_HOSTS=api.weather.example
```

The app uses a secret by name; its value stays with the bridge, is sent only to
the hosts listed, and never reaches the browser or an agent. The bridge uses no
secret from a file that other users can read or that git could commit, and the
*Assistant setup* window (section *On this machine*) says what is wrong if so.
An edit to `.env` takes effect without a restart.

**Conversations** with the assistant are kept in the browser and in
`.werkbank/conversations.json` in the app's folder; workspaces, settings and
custom elements likewise in `.werkbank/app-data.json`. They survive clearing
the browser's data and are there in another browser. Switch the files off
under Settings → Assistant and Settings → Storage. Both `.env` and
`.werkbank/` are in a new app's `.gitignore`; do not commit either.

Both need the app's Vite config to use `bridgeProxy()` from
`@werkbank/bridge/vite`, which new apps do.

Every app has an agent bridge of its own, on a port of its own
(`werkbank.bridgePort` in its `package.json`; a new app gets its own port plus
3000). To run several apps at once, give each a different port:
`npm run new:app -- <folder> "Title" --port 5300`. A bridge that finds another
app's bridge on its port stops and says so.

## Install with a coding agent

Paste one of these into your coding agent.

**To try the reference app:**

> Please clone `https://github.com/julian-hilg/werkbank.git`, run `npm install` in it, and start it with `npm run dev`. It needs Node.js 22 or newer; if that is missing, install it first. Check that http://localhost:5199 answers and that `curl http://127.0.0.1:8199/health` returns JSON naming `werkbank-bridge`. Then tell me the address to open, and how to connect you to the running app (the app's *Assistant setup* window gives the command).

**To start an app of my own on Werkbank:**

> Please create a new app on the Werkbank framework. Clone `https://github.com/julian-hilg/werkbank.git` next to where the app should live and run `npm install` in it. Then run `npm run new:app -- <path-to-my-app> "<App title>" --from release` there, and `npm install` in the new app. Before writing any code, read `AGENTS.md` in the new app, `node_modules/@werkbank/framework/GUIDE.md` and the skill in `.claude/skills/werkbank-app/SKILL.md`, and follow them: build the backend of a feature (schema, store, commands) before its panels, every action is a command, every panel returns its data from `describe`, and the framework in `node_modules` is never edited. Start the app with `npm run dev`, confirm it opens at http://localhost:5200, and then ask me what the app is for before building panels.

**To update an app to the newest Werkbank:**

> Please update this app to the newest Werkbank release: run `npm run werkbank:update`. If the type-check it runs fails, read `node_modules/@werkbank/framework/CHANGELOG.md` for the versions in between and adapt the app's code; do not edit anything inside `node_modules`. Then start the app, open a workspace that was saved before the update, and tell me about any notices in the status bar.

**To build a feature in an app:**

> Please add <what the feature does> to this app, using the `werkbank-app` skill: backend first (one schema for the record, a store, commands with the right risk and an undo), then the panel, then verify it in the running app through the bridge's MCP tools and with `npm run check:rules`. Tell me what you verified and what you could not.

## Updating

- **The reference app:** `git pull && npm install`.
- **An app of your own:** `npm run werkbank:update` in the app
  (`-- 0.7.0` for a specific version). It also refreshes the app's copy of
  the skill. See [docs/upgrading.md](docs/upgrading.md).
- **The skill in `~/.claude/skills`:** `npm run skill:install` again after
  updating the checkout.

## Uninstalling

Delete the folder, and `~/.claude/skills/werkbank-app` if you installed the
skill there. The app keeps workspaces, settings and custom elements in
the browser's storage for its address; clear the site data for
`localhost:5199` (or `:5200`) to remove them.
