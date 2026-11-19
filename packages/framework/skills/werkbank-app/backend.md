# Backend: schema, store, commands

Everything here is plain TypeScript with no React and no DOM, in
`src/<domain>/`. Work top to bottom. Guide sections 5, 6 and 8 are the reference.

## 1. One schema per record

`src/<domain>/store.ts` defines what a valid record is, once. The store, the
commands, the form and storage all validate against it, so an agent cannot
write what the form would reject. Messages are sentences a person can act on.

```ts
import { z } from "zod";

export const entryFields = z.object({
  account: z.string().min(1, "Choose an account."),
  amount: z.number("Enter an amount.").describe("In the account's currency"),
  note: z.string().max(500, "Keep the note under 500 characters."),
});
export type EntryFields = z.infer<typeof entryFields>;
export interface Entry extends EntryFields { id: string }
```

## 2. A store that holds facts

A plain class with `subscribe`. It takes its storage as an argument so a test
can pass `null`. Mutations return what an undo needs: `create` the new record,
`update` the record as it was, `remove` the record and its position.

```ts
const KEY = "ledger.entries";            // "<appId>.<name>"; never change it after release

export class EntryStore {
  private entries: Entry[];
  private listeners = new Set<() => void>();
  constructor(private storage: Pick<Storage, "getItem" | "setItem"> | null) {
    this.entries = this.load() ?? [];
  }
  getAll = (): Entry[] => this.entries;                 // same array until something changes
  get = (id: string) => this.entries.find((e) => e.id === id);
  subscribe = (fn: () => void) => (this.listeners.add(fn), () => void this.listeners.delete(fn));

  create(fields: EntryFields): Entry {
    const entry = { ...entryFields.parse(fields), id: crypto.randomUUID() };
    this.commit([...this.entries, entry]);
    return entry;
  }
  update(id: string, patch: Partial<EntryFields>): Entry {
    const before = this.get(id);
    if (!before) throw new Error(`Unknown entry: ${id}`);
    const { id: _id, ...current } = before;
    this.commit(this.entries.map((e) => (e.id === id ? { ...entryFields.parse({ ...current, ...patch }), id } : e)));
    return before;
  }
  remove(id: string): { entry: Entry; index: number } {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index < 0) throw new Error(`Unknown entry: ${id}`);
    const entry = this.entries[index]!;
    this.commit(this.entries.filter((e) => e.id !== id));
    return { entry, index };
  }
  restore(entry: Entry, index?: number): void {          // used by undo
    const others = this.entries.filter((e) => e.id !== entry.id);
    others.splice(index ?? others.length, 0, entry);
    this.commit(others);
  }
  private commit(entries: Entry[]): void {
    this.entries = entries;                              // a new array: subscribers compare by identity
    try { this.storage?.setItem(KEY, JSON.stringify(entries)); } catch { /* lasts for this page load only */ }
    this.listeners.forEach((fn) => fn());
  }
  private load(): Entry[] | null {
    try {
      const stored = z.array(entryFields.extend({ id: z.string() })).safeParse(JSON.parse(this.storage?.getItem(KEY) ?? "null"));
      return stored.success ? stored.data : null;
    } catch { return null; }
  }
}
export const entries = new EntryStore(typeof localStorage === "undefined" ? null : localStorage);
```

- **Store facts, derive the rest.** Keep entries; compute balances and totals
  with exported pure functions (`balanceOf(entries, account)`). A stored total
  goes stale. Panels and `describe` call the same function, so they agree.
- **Snapshots are stable.** `getAll` returns the same reference until `commit`
  runs, otherwise `useSyncExternalStore` re-renders forever.
- **Data from a server:** the store holds what was loaded plus a status
  (`idle`, `loading`, `ready`, `error` with a message) and a time. Loading is
  started by a command or by a panel that is on screen, never by the store's
  constructor and never by a workspace being restored. Data that stopped
  updating is stale: say so, and make commands that depend on it refuse.

## 3. Commands

`src/<domain>/commands.ts`. A command is the only way anything happens.

```ts
import type { Command, Werkbank } from "@werkbank/framework";
import { z } from "zod";
import { entries, entryFields, type Entry, type EntryFields } from "./store";

export const entryCommands: Command<Werkbank, any>[] = [
  {
    id: "entry.create",                       // noun.verb, stable
    title: "Create entry",
    category: "Ledger",
    risk: "local",
    input: entryFields,
    run: (_ctx, fields: EntryFields) => entries.create(fields),            // return the result
    undo: (_ctx, _input, created) => void entries.remove((created as Entry).id),
  },
  {
    id: "entry.update",
    title: "Update entry",
    category: "Ledger",
    risk: "local",
    input: z.object({ id: z.string(), patch: entryFields.partial() }),
    run: (_ctx, i: { id: string; patch: Partial<EntryFields> }) => entries.update(i.id, i.patch),
    undo: (_ctx, _input, before) => entries.restore(before as Entry),
  },
];
```

| `risk` | Use it when | An agent |
| --- | --- | --- |
| `read` | nothing changes | runs it freely |
| `local` | the workspace or the app's own data changes **and `undo` reverses it** | runs it freely; the person can undo |
| `external` | something outside the app is affected: a server write, a message, an order | waits for approval |
| `irreversible` | it cannot be undone | waits for approval |

- No `undo`, not `local`. When unsure between two classes, take the stricter one.
- `.describe()` every input field whose meaning or unit is not obvious: that
  text is the agent's documentation.
- Throw `Error` with a sentence that says what happened and what to do.
- A command that only reads still earns its place when no panel's `describe`
  returns that data.
- Options: `keys: "mod+e"` (never Alt), `palette: false`, `log: false` for pure
  view changes, `when` to hide and refuse, `expand` for ready-made palette entries.

## 4. Register in `src/app.ts`

- `commands: [...entryCommands]`.
- A **topic** for every "current selection" panels share:
  `topics: { account: z.string().nullable() }`. No events, no global store.
- A **setting** for a value that belongs to the person rather than a workspace:
  `{ key: "ledger.currency", title, section, schema, default, description }`.
- `assistant.brief`: what the app is for, which data is real, what needs care.
  Update it when the feature changes the answer.

## 5. Reaching outside, and secrets

A browser page cannot call most APIs, and must never hold a key. Ask the bridge:
`await bridgeService(wb, "http.get" | "http.request" | "mcp.tools" | "mcp.call", params)` returns
`{ ok, value }` or `{ ok: false, error }`. Call it from a command's `run`.

A key, token or password goes in the app's `.env` file and nowhere else:

```
WERKBANK_SECRET_WEATHER=the-key
WERKBANK_SECRET_WEATHER_HOSTS=api.weather.example
```

and is used by name. The bridge attaches the value, to those hosts only, and
strips it from the answer; the app and the agent never see it.

```ts
run: async ({ wb }, i: { city: string }) => {
  const result = await bridgeService(wb, "http.get", { url: `https://api.weather.example/v1/${encodeURIComponent(i.city)}`, auth: { secret: "WEATHER" } });
  if (!result.ok) throw new Error(result.error);
  return (result.value as { body: unknown }).body;
},
```

- `auth: { secret, as: "header", header: "x-api-key" }` for APIs that do not use `Authorization: Bearer`.
  For another MCP server: `{ url, secret: "NAME" }` with `mcp.tools` and `mcp.call`.
- Which secrets exist (names and hosts, never values): `useMeta((m) => m.home?.secrets)`,
  and the Assistant setup window shows them with anything wrong in `.env`.
- **Never** put a credential in `src/`, a setting, panel state, a store, `localStorage`, a
  `VITE_` variable, a log line, an error message or `describe`. Never read, print or
  commit `.env`; when a person needs a secret, tell them the two lines to add.
- `.env` must be readable by its owner alone (`chmod 600 .env`) and ignored by git;
  the bridge uses no secret otherwise. `npm run check:rules` checks both.
- **Writing to an API:** `bridgeService(wb, "http.request", { url, method: "POST", json: {...}, auth: { secret } })`
  (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`; `body` for text instead of `json`). It changes
  something outside the app, so it is only ever called from a command with
  `risk: "external"` (or `"irreversible"` for a delete that cannot be taken back): an
  agent's request then waits for the person's approval, with the exact input shown.
  `npm run check:rules` refuses a file that uses it without such a command.
- Database drivers and long-running jobs belong in a server of the app's own.

## 6. Test it

Where the app has a test runner (`npm test`), test the store with
`new EntryStore(null)`: validation by field, each mutation and its inverse, and
every derived number against a case worked by hand. Where it has none, say so
in the report rather than adding one unasked.

## Done when

- [ ] One schema; the store parses with it on every write and on load
- [ ] Derived values are functions, not stored fields
- [ ] Every action is a command with `risk`, described inputs and, if `local` on app data, `undo`
- [ ] Commands, topics and settings are listed in `src/app.ts`
- [ ] `npm run typecheck` passes, and an agent could do the whole task with `werkbank_run`
