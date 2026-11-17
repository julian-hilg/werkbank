# Frontend: hooks, panels, workspaces

The frontend shows what the backend holds and calls its commands. If you find
yourself adding logic here, it belongs in [backend.md](backend.md). Guide
sections 4, 7, 9 and 11 are the reference.

## 1. A hook on the store

`src/<domain>/hooks.ts` is the only place React meets a store.

```ts
import { useSyncExternalStore } from "react";
import { entries, type Entry } from "./store";

export const useEntries = (): Entry[] => useSyncExternalStore(entries.subscribe, entries.getAll);
```

Derive in the component with `useMemo` over the snapshot, using the backend's
pure functions. Do not copy store data into `useState`.

## 2. One file per tool

`src/tools/<id>.tsx`. There is no other way to add a panel.

```tsx
import { defineTool, useLink, useToolState, useWerkbank } from "@werkbank/framework";
import { z } from "zod";
import { useEntries } from "../ledger/hooks";
import { balanceOf, entries } from "../ledger/store";

const stateSchema = z.object({ sort: z.enum(["date", "amount"]) });     // small, serialisable
type State = z.infer<typeof stateSchema>;

function Entries() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();                       // saved with the workspace
  const [account, setAccount] = useLink<string | null>("account");       // shared with the link group
  const rows = useEntries().filter((e) => !account || e.account === account);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="wb-toolhead">
        <strong>Entries</strong>
        <button className="wb-button" onClick={() => void wb.run("entry.create", { account, amount: 0, note: "" })}>New entry</button>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {rows.length === 0 ? <p className="wb-hint">No entries yet. Create one with "New entry".</p> : rows.map((e) => (
          <div key={e.id} className="wb-row" onClick={() => setAccount(e.account)}>
            <span>{e.note}</span> <span className="wb-num">{e.amount.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const entriesTool = defineTool<State>({
  id: "entries",                    // stable: saved workspaces refer to it
  title: "Entries",
  glyph: "▤",
  category: "Ledger",
  version: 1,                       // bump when stateSchema changes shape, and add migrate
  stateSchema,
  defaultState: () => ({ sort: "date" }),
  links: ["account"],
  component: Entries,
  describe: (state, { links }) => {
    const account = (links.account as string | null) ?? null;
    const rows = entries.getAll().filter((e) => !account || e.account === account);
    return { account, sort: state.sort, balance: account ? balanceOf(entries.getAll(), account) : null, count: rows.length, rows: rows.slice(0, 200) };
  },
});
```

**State has three homes.** Pick by who must see it and how long it lives.

| What | Where |
| --- | --- |
| Domain data: records, prices, results | a store (backend) |
| The panel's own persistent choices: sort, filter, a form draft | `useToolState` |
| The selection linked panels share | `useLink(topic)` |
| A value for the whole app and person | `useSetting(key)` |
| Hover, an open menu, a drag in progress | `useState` |

**`describe` is the panel for an agent.** Return what the view shows: the
selection, the rows and the derived numbers, as plain JSON, computed by the
same functions the view uses. Put units in key names (`amountEur`). Cap long
lists and include the full `count`. Never return secrets.

**Every panel handles four states:** empty (say what to do), loading, error
(what happened, what to do), and stale data (dimmed and labelled).

## 3. Interface rules

- **Layout.** Fill the panel (`height: 100%`); start with a `.wb-toolhead` bar.
  It must work narrow: panels get docked into thin columns.
- **Colour.** Tokens only: `--wb-canvas`, `--wb-face`, `--wb-text`,
  `--wb-text-dim`, `--wb-border`, `--wb-grid`, `--wb-accent`, `--wb-good`,
  `--wb-bad`, `--wb-warn`. No hex, no `rgb()`. In canvas code read them with
  `getComputedStyle`.
- **Classes.** Use `wb-button`, `wb-input`, `wb-badge`, `wb-hint`, `wb-row`,
  `wb-list-item`, `wb-segment`, `wb-num`, `wb-up`, `wb-down`, `wb-form*`,
  `wb-control*`. The app's own classes get the app's prefix in the app's
  stylesheet. Do not restyle `wb-*` or rely on the shell's DOM.
- **Controls.** `Select` (`searchable` from about ten options), `MultiSelect`,
  `SearchBox`. Never `<select>` or `<datalist>`.
- **Actions.** Buttons, menus and keys call `wb.run`. Right-click menus:
  `openContextMenu(wb, event, items)`, with items that run commands.
- **Forms.** Keep what was typed as strings in tool state so a half-filled form
  survives a reload. On submit, parse the whole record with the backend's
  schema, show one message per field beside the field, submit through a command.
- **Charts.** One axis per chart. One hue for magnitude; `--wb-good` and
  `--wb-bad` around a neutral for gain and loss, with a sign or label as well
  as the colour. A hover readout, and the numbers in `describe`.
- **Heavy views.** A large library or data file: definition in `<id>.tsx`,
  component in `<id>.view.tsx` loaded with `React.lazy`. Check the build output.
- **Text.** Plain and specific, in the words the app's users use.

## 4. Register, place, document

In `src/app.ts`:

1. Add the tool to `tools`.
2. Give it a place: an instance in `defaultWorkspace` or a preset, with its id
   exactly once in `layout` and a `link` group shared with the panels it
   should follow. Sizes are percentages of the parent split.
3. Add or update a page in `docs` when a user needs to know about the feature.

People who already use the app keep their saved workspace: they find a new
tool in the Tools view, not in their layout. Do not try to change that.

## Done when

- [ ] The panel reads through a hook and changes things only through `wb.run`
- [ ] `describe` returns the data on screen, bounded
- [ ] Persistent panel state is in `useToolState`; `version` and `migrate` are right
- [ ] Empty, loading, error and stale states exist
- [ ] Registered in `tools`, placed in a workspace, documented
- [ ] It looks right in every theme and in a narrow panel
