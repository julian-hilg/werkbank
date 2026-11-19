import { FRAMEWORK_VERSION, type Werkbank } from "./werkbank";

/**
 * The documentation shown in the app's settings window. The framework's own
 * pages describe what every Werkbank app can do; an app adds pages about
 * itself with `docs` in its config, and those come first.
 */
export interface DocPage {
  id: string;
  title: string;
  /** Markdown. */
  text: string;
}

const WORKSPACE = `# Working with the workspace

The window is one workspace made of **panels**. Every panel is a tab; tabs sit in groups, and groups can be split, resized and rearranged freely.

## Panels

- **Open a panel:** click it in the *Tools* view (the first button in the left rail), or drag it from there to the place you want it. The command palette opens panels too.
- **A tool that is already open** has a dot in the *Tools* view. Clicking it takes you to its panel instead of opening a second one, and the tab lights up for a moment. "Open …" in the command palette does the same. To have the same tool twice, drag it from the list into the layout, or choose "Open another …" in the palette.
- **Move a panel:** drag its tab. Drop it on another group's tab bar to join that group, on the middle of a group to do the same, or near an edge to split the group or the whole window.
- **Some panels keep a group to themselves**, where the app decided they should always be in view. Nothing can be stacked on them; a panel dropped there lands beside them.
- **Resize:** drag the line between two groups.
- **Maximise a group:** double-click its tab bar, or use the square button at its right end. The same action restores it.
- **Own window:** the arrow button in a tab bar moves the active panel into a separate browser window. Closing that window puts the panel back.
- **Close:** the cross on the tab. Closing can be undone.
- **Right-click** a tab, and most rows, charts and cards, for the actions that apply there.

## Linked panels

A coloured dot on a tab is its **link group**. Panels in the same group share a selection: choose a symbol, a task or a date range in one and the others follow. Click the dot to move the panel to another group or to unlink it. There are four groups.

## The command palette

Press **Ctrl/Cmd + K**. Everything the app can do is a command: opening panels, changing the layout, switching workspaces, and the app's own actions. Type a few letters and press Enter.

## Workspaces

The arrangement of panels, their state and the link groups are a **workspace**. It is saved as you work, in this browser and, when the app runs with its agent bridge, in the app's own folder on this machine. In the *Workspaces* view you can save a workspace under a name, load one, start from a preset, and export or import one as a file to share it.

## History and undo

The *Action history* view lists what was done, by you and by agents, newest first. **Undo last action** reverses layout changes and any action on the app's data that can be reversed.

## Settings

The gear in the rail (or **Ctrl/Cmd + ,**) opens this window. Settings are stored in this browser.
`;

const ASSISTANT = `# The assistant and other agents

A Werkbank app can be read and operated by AI agents as well as by you. An agent does not look at pixels: it reads the data behind each panel and runs the same commands the palette offers.

## The Assistant panel

Open the **Assistant** panel and type a request, for example "put the chart next to the order book" or "what changed in my positions today?". The message goes to a coding agent installed on this computer (Claude Code, Codex, or another the app has an adapter for), which acts on this window.

- **Setup** in the panel's header chooses the agent and shows whether the local bridge is running. The model an agent uses is set in that agent's own configuration.
- **Chats** lists your conversations. Double-click one to rename it; right-click for more. With more than a few, a search field finds one by its title or by anything said in it.
- **Conversations are kept by the app, not by the panel.** They stay when you close the Assistant panel, switch or reset the workspace, or reload the page, and every Assistant panel and every tab of the app shows the same list. They are stored in this browser and, when the app runs with its agent bridge, in a file in the app's own folder on this machine (.werkbank/), so they are still there after the browser's data is cleared. *Assistant setup* shows where they are kept and has the switch for it. A workspace you export does not contain them. Deleting or renaming one can be undone from the action history.
- Tool calls appear in the conversation as they happen. When a reply changed something in the app, **Undo this change** under it takes that back.
- **Attach a panel** (beside the message field) sends a panel's data along with your message, so the agent does not have to look for it.
- The menu above the conversation list exports all conversations to a file, imports such a file, and deletes all of them.

## Your own agent, in a terminal

Any agent that speaks MCP can connect. *Assistant setup* (the star in the rail) gives the one-line command for your agent and a briefing written for this app to paste as the first message.

## What an agent may do

- Everything an agent does is recorded in the action history as the agent's, and can be undone like your own actions.
- Actions that reach outside the app or cannot be reversed wait for your approval: a dialog shows what the agent wants to do, and nothing happens until you allow it.
- An agent only works while the app is open and the bridge is connected. Switch the connection off under *Settings → Assistant*.

## Other programs

The same connection lets other MCP-capable programs read this app's data, so it can serve as a data source for them.
`;

const ELEMENTS = `# Building your own panels

You can add panels of your own without changing the app. They are called **custom elements** and are marked **(C)** in the Tools view.

## With the Crafter

1. Open the **Crafter** panel and click *New element*.
2. Describe what you want, for example "my five largest positions as horizontal bars". The agent writes the element and it appears in the preview.
3. Ask for changes in the same box, or edit the *Source* tab yourself.
4. *Open as a panel* puts it in your workspace like any other panel.

Any connected agent can do the same when you ask it for a panel.

## What an element can and cannot do

An element is one HTML document that runs in a sandbox:

- It **can** read the data behind the open panels, follow and set the linked selection, keep its own state, call the read-only functions the app offers, and draw with the chart libraries the app provides.
- It **cannot** reach the network, the app's storage or your other tabs, and it cannot run commands.

## Sharing

*Export* saves an element as a file; *Import from file* adds one a colleague sent you. An imported element arrives as a draft of your own and runs in the same sandbox.

*Submit for review* packages an element for the people who maintain the app. Once reviewed it can ship with the app for everyone, listed under *Elements*.
`;

const KEY_NAMES: Record<string, string> = { mod: "Ctrl/Cmd", shift: "Shift", enter: "Enter", escape: "Esc", arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓" };
const keyLabel = (keys: string) => keys.split("+").map((k) => KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k)).join(" + ");

function shortcuts(wb: Werkbank): string {
  const rows = wb.commands.list().filter((c) => c.keys).map((c) => `| ${keyLabel(c.keys!)} | ${c.title} |`);
  return `# Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl/Cmd + K | Open the command palette |
${rows.join("\n")}
| Esc | Close a menu, a dropdown or this window |

In lists and dropdowns the arrow keys move, Enter chooses, and typing filters where a list is searchable. Every other action is in the command palette.
`;
}

const about = (wb: Werkbank) => `# About

**${wb.config.title}**${wb.config.version ? ` ${wb.config.version}` : ""}

Built with **Werkbank** ${FRAMEWORK_VERSION}, a framework for dockable workspaces that people and AI agents operate together.

Werkbank is open source (MIT), written by Julian Hilg: [github.com/julian-hilg/werkbank](https://github.com/julian-hilg/werkbank).

Workspaces, settings and custom elements are stored in this browser and, when the app runs with its agent bridge, in a file in the app's own folder on this machine (.werkbank/); *Settings → Storage* has the switch for the file. Nothing is sent anywhere unless a panel or an agent you use does so.
`;

/** The pages of the settings window's Documentation section, in order. */
export function documentation(wb: Werkbank): DocPage[] {
  return [
    ...(wb.config.docs ?? []),
    { id: "workspace", title: "Working with the workspace", text: WORKSPACE },
    { id: "assistant", title: "The assistant and other agents", text: ASSISTANT },
    ...(wb.tools.has("crafter") ? [{ id: "elements", title: "Building your own panels", text: ELEMENTS }] : []),
    { id: "shortcuts", title: "Keyboard shortcuts", text: shortcuts(wb) },
    { id: "about", title: "About", text: about(wb) },
  ];
}
