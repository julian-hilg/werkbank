import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Werkbank,
  assistantSetup,
  memoryStore,
  tabIds,
  mergeTabs,
  filterTabs,
  eventKeys,
  normaliseKeys,
  type KeyValueStore,
  type ToolSpec,
  type WerkbankConfig,
  type Layout,
} from "../src/core";

const note: ToolSpec<{ text: string }> = {
  id: "note",
  title: "Note",
  version: 2,
  stateSchema: z.object({ text: z.string() }),
  defaultState: () => ({ text: "" }),
  migrate: (state, from) => (from === 1 ? { text: (state as { body: string }).body } : state),
  links: ["symbol"],
  describe: (state, ctx) => ({ length: state.text.length, symbol: ctx.links.symbol ?? null }),
};

const config = (storage: KeyValueStore = memoryStore(), extra: Partial<WerkbankConfig> = {}): WerkbankConfig => ({
  appId: "test",
  title: "Test",
  tools: [note],
  topics: { symbol: z.string().min(1) },
  storage,
  defaultWorkspace: {
    layout: { root: { type: "tabset", id: "root", tabs: [{ id: "note-1" }] } },
    instances: [{ id: "note-1", toolId: "note", link: "1" }],
    links: { "1": { symbol: "AAA" } },
  },
  ...extra,
});

describe("workspace document", () => {
  it("builds the default workspace from its seed", () => {
    const wb = new Werkbank(config());
    expect(Object.keys(wb.getDoc().instances)).toEqual(["note-1"]);
    expect(wb.getDoc().instances["note-1"]!.state).toEqual({ text: "" });
    expect(wb.getMeta().source).toBe("default");
  });

  it("persists and restores panels, state and links", () => {
    const store = memoryStore();
    const a = new Werkbank(config(store));
    const id = a.open("note", { state: { text: "hello" } });
    a.publish("note-1", "symbol", "BBB");
    a.flush();
    const b = new Werkbank(config(store));
    expect(b.getMeta().source).toBe("saved");
    expect(b.getDoc().instances[id]!.state).toEqual({ text: "hello" });
    expect(b.linksOf("note-1")).toEqual({ symbol: "BBB" });
    expect(tabIds(b.getDoc().layout).sort()).toEqual(["note-1", id].sort());
  });

  it("falls back to the last good copy and keeps the rejected one", () => {
    const store = memoryStore();
    const a = new Werkbank(config(store));
    a.open("note");
    a.flush();
    a.open("note");
    a.flush(); // first save is now last-good
    store.setItem("test.workspace.current", "{ not json");
    const b = new Werkbank(config(store));
    expect(b.getMeta().source).toBe("last-good");
    expect(Object.keys(b.getDoc().instances)).toHaveLength(2);
    expect(store.getItem("test.workspace.rejected")).toBe("{ not json");
    expect(b.getMeta().notes[0]).toMatch(/last good/);
  });

  it("drops unknown tools and orphan tabs, and resets invalid state", () => {
    const wb = new Werkbank(config());
    const notes = wb.loadDoc({
      ...wb.getDoc(),
      layout: { root: { type: "tabset", id: "root", tabs: [{ id: "note-1" }, { id: "ghost-1" }, { id: "gone-1" }] } },
      instances: {
        "note-1": { id: "note-1", toolId: "note", version: 2, state: { text: 5 }, link: null, local: {} },
        "ghost-1": { id: "ghost-1", toolId: "ghost", version: 1, state: {}, link: null, local: {} },
      },
    });
    expect(Object.keys(wb.getDoc().instances)).toEqual(["note-1"]);
    expect(wb.getDoc().instances["note-1"]!.state).toEqual({ text: "" });
    expect(tabIds(wb.getDoc().layout)).toEqual(["note-1"]);
    expect(notes.join(" ")).toMatch(/unknown tool/);
  });

  it("migrates state written by an older tool version", () => {
    const wb = new Werkbank(config());
    wb.loadDoc({
      ...wb.getDoc(),
      instances: { "note-1": { id: "note-1", toolId: "note", version: 1, state: { body: "old" }, link: null, local: {} } },
    });
    expect(wb.getDoc().instances["note-1"]).toMatchObject({ version: 2, state: { text: "old" } });
  });

  it("rejects a document that is not a workspace", () => {
    const wb = new Werkbank(config());
    expect(() => wb.loadDoc({ hello: "world" })).toThrow(/not a valid workspace/);
    expect(Object.keys(wb.getDoc().instances)).toEqual(["note-1"]);
  });
});

describe("linking", () => {
  it("shares a value inside a group and keeps independents apart", () => {
    const wb = new Werkbank(config());
    const linked = wb.open("note", { link: "1" });
    const solo = wb.open("note");
    wb.publish(linked, "symbol", "CCC");
    expect(wb.linksOf("note-1").symbol).toBe("CCC");
    expect(wb.linksOf(solo).symbol).toBeUndefined();
    wb.publish(solo, "symbol", "ZZZ");
    expect(wb.linksOf("note-1").symbol).toBe("CCC");
    expect(wb.linksOf(solo).symbol).toBe("ZZZ");
  });

  it("keeps the shown value when a panel leaves its group", () => {
    const wb = new Werkbank(config());
    wb.setLink("note-1", null);
    expect(wb.linksOf("note-1").symbol).toBe("AAA");
    wb.publishToGroup("1", "symbol", "BBB");
    expect(wb.linksOf("note-1").symbol).toBe("AAA");
  });

  it("gives a late joiner the group's last value, and seeds an empty group", () => {
    const wb = new Werkbank(config());
    const late = wb.open("note");
    wb.setLink(late, "1");
    expect(wb.linksOf(late).symbol).toBe("AAA");
    const solo = wb.open("note");
    wb.publish(solo, "symbol", "QQQ");
    wb.setLink(solo, "2");
    expect(wb.getDoc().links["2"]).toEqual({ symbol: "QQQ" });
  });

  it("validates published values against the topic schema", () => {
    const wb = new Werkbank(config());
    expect(() => wb.publish("note-1", "symbol", "")).toThrow();
    expect(wb.linksOf("note-1").symbol).toBe("AAA");
  });
});

describe("commands", () => {
  it("runs, validates input and reports failures as results", async () => {
    const wb = new Werkbank(config());
    const opened = await wb.run("panel.open", { toolId: "note" });
    expect(opened).toEqual({ ok: true, value: "note-2" });
    expect(await wb.run("panel.open", { toolId: 7 })).toMatchObject({ ok: false, code: "invalid" });
    expect(await wb.run("panel.open", { toolId: "nope" })).toMatchObject({ ok: false, code: "failed" });
    expect(await wb.run("no.such")).toMatchObject({ ok: false, code: "unknown" });
  });

  it("finds the open panel a click on a tool goes to, walking through several", async () => {
    const wb = new Werkbank(config());
    expect(wb.openPanelOf("nope")).toBeUndefined();
    await wb.run("panel.focus", { id: "note-1" });
    expect(wb.openPanelOf("note")).toBe("note-1"); // the only one, even while it is active
    await wb.run("panel.open", { toolId: "note" }); // note-2 is now active
    expect(wb.openPanelOf("note")).toBe("note-1");
    await wb.run("panel.focus", { id: "note-1" });
    expect(wb.openPanelOf("note")).toBe("note-2");
    expect(Object.keys(wb.getDoc().instances).filter((id) => id.startsWith("note-"))).toHaveLength(2);
  });

  it("lists palette entries with expanded inputs", () => {
    const wb = new Werkbank(config());
    const titles = wb.commands.palette(wb).map((e) => e.title);
    expect(titles).toContain("Open Note");
    expect(titles).toContain("Theme: dark");
    expect(titles).not.toContain("Describe workspace");
    expect(titles).not.toContain("Undo last workspace action"); // nothing to undo yet
  });

  it("describes commands with JSON schemas for agents", () => {
    const wb = new Werkbank(config());
    const index = wb.commands.describe(wb);
    expect(index.find((c) => c.id === "panel.open")).toMatchObject({ risk: "local", undoable: true, takesInput: true });
    expect(index[0]).not.toHaveProperty("input"); // the index is compact; schemas come on request
    const [open] = wb.commands.describe(wb, { ids: ["panel.open"] });
    expect((open!.input as { properties: object }).properties).toHaveProperty("toolId");
    expect(wb.commands.describe(wb, { query: "theme" }).map((c) => c.id)).toEqual(["view.theme"]);
  });

  it("undoes structure but keeps edits made since", async () => {
    const wb = new Werkbank(config());
    await wb.run("panel.close", { id: "note-1" });
    expect(wb.getDoc().instances["note-1"]).toBeUndefined();
    const other = wb.open("note");
    wb.setState(other, { text: "typed after the close" });
    wb.undo();
    expect(wb.getDoc().instances["note-1"]).toBeDefined();
    expect(tabIds(wb.getDoc().layout)).toContain("note-1");
    // `other` did not exist before the close, so undo removes it again.
    expect(wb.getDoc().instances[other]).toBeUndefined();
  });

  it("keeps a surviving panel's later edits, but reverts state the command changed", async () => {
    const wb = new Werkbank(config());
    await wb.run("panel.setState", { id: "note-1", patch: { text: "by agent" } }, "agent");
    wb.undo();
    expect(wb.getDoc().instances["note-1"]!.state).toEqual({ text: "" });

    const second = wb.open("note");
    await wb.run("panel.link", { id: second, group: "2" });
    wb.setState("note-1", { text: "typed later" });
    wb.undo();
    expect(wb.getDoc().instances[second]!.link).toBeNull();
    expect(wb.getDoc().instances["note-1"]!.state).toEqual({ text: "typed later" });
  });

  it("records who did what, and skips view-only commands", async () => {
    const wb = new Werkbank(config());
    await wb.run("view.theme", { theme: "dark" });
    await wb.run("panel.open", { toolId: "note" }, "agent");
    expect(wb.getDoc().shell.theme).toBe("dark");
    expect(wb.getMeta().log.map((e) => [e.actor, e.commandId])).toEqual([["agent", "panel.open"]]);
  });

  it("asks a person before an agent does something irreversible", async () => {
    const wb = new Werkbank(config());
    await wb.run("workspace.save", { name: "keep" });
    const denied = wb.run("workspace.delete", { name: "keep" }, "agent");
    expect(wb.getMeta().pendingApproval?.commandId).toBe("workspace.delete");
    wb.resolveApproval(false);
    expect(await denied).toMatchObject({ ok: false, code: "denied" });
    expect(wb.storage.names()).toEqual(["keep"]);

    const approved = wb.run("workspace.delete", { name: "keep" }, "agent");
    wb.resolveApproval(true);
    expect(await approved).toMatchObject({ ok: true });
    expect(wb.storage.names()).toEqual([]);

    // A person is not asked.
    await wb.run("workspace.save", { name: "again" });
    expect(await wb.run("workspace.delete", { name: "again" })).toMatchObject({ ok: true });
  });

  it("saves, loads and resets named workspaces", async () => {
    const wb = new Werkbank(config());
    await wb.run("panel.open", { toolId: "note" });
    await wb.run("workspace.save", { name: "two" });
    await wb.run("workspace.reset");
    expect(Object.keys(wb.getDoc().instances)).toEqual(["note-1"]);
    await wb.run("workspace.load", { name: "two" });
    expect(Object.keys(wb.getDoc().instances).sort()).toEqual(["note-1", "note-2"]);
  });
});

describe("describe()", () => {
  it("gives agents panel data instead of pixels", () => {
    const wb = new Werkbank(config());
    wb.setState("note-1", { text: "abc" });
    const view = wb.describe() as { panels: { id: string; data: unknown; linkGroup: string }[] };
    expect(view.panels[0]).toMatchObject({ id: "note-1", linkGroup: "1", data: { length: 3, symbol: "AAA" } });
  });
});

describe("describe() detail levels", () => {
  it("a summary lists panels without their state or data", () => {
    const wb = new Werkbank(config());
    const view = wb.describe({ detail: "summary" }) as { panels: Record<string, unknown>[]; note: string };
    expect(view.panels[0]).toMatchObject({ id: "note-1", tool: "note" });
    expect(view.panels[0]).not.toHaveProperty("data");
    expect(view.note).toMatch(/Summary only/);
  });

  it("can be limited to some panels, and names ids it does not know", () => {
    const wb = new Werkbank(config());
    wb.open("note");
    const view = wb.describe({ panels: ["note-2", "nope"] }) as { panels: { id: string; data: unknown }[]; unknownPanels: string[] };
    expect(view.panels.map((p) => p.id)).toEqual(["note-2"]);
    expect(view.panels[0]!.data).toBeDefined();
    expect(view.unknownPanels).toEqual(["nope"]);
  });
});

describe("layout helpers", () => {
  const layout: Layout = {
    root: {
      type: "split",
      id: "s",
      orientation: "horizontal",
      children: [
        { type: "tabset", id: "a", tabs: [{ id: "x" }] },
        { type: "tabset", id: "b", selectedId: "z", tabs: [{ id: "y" }, { id: "z" }] },
      ],
    },
    maximizedTabsetId: "a",
  };

  it("collapses splits left with one child and fixes selection", () => {
    const out = filterTabs(layout, (t) => t.id !== "x" && t.id !== "z");
    expect(out.root).toMatchObject({ type: "tabset", id: "b", selectedId: "y" });
    expect(out.maximizedTabsetId).toBeUndefined();
  });

  it("merges popped-out tabs back without duplicating", () => {
    expect(tabIds(mergeTabs(layout, [{ id: "p" }, { id: "x" }]))).toEqual(["x", "p", "y", "z"]);
  });
});

describe("keys", () => {
  it("matches events to bindings on both platforms", () => {
    const e = { key: "K", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false };
    expect(eventKeys(e)).toContain(normaliseKeys("mod+k"));
    expect(eventKeys({ ...e, key: "ArrowLeft", metaKey: false, ctrlKey: true, shiftKey: true })).toContain(
      normaliseKeys("ctrl+shift+ArrowLeft"),
    );
  });
});

describe("commands that change the app's own data", () => {
  it("undo calls the command's inverse with what run returned", async () => {
    const shelf: string[] = [];
    const wb = new Werkbank(
      config(memoryStore(), {
        commands: [
          {
            id: "shelf.add",
            title: "Add to shelf",
            risk: "local",
            input: z.object({ item: z.string() }),
            run: (_ctx, i: { item: string }) => shelf.push(i.item) - 1,
            undo: (_ctx, _input, index) => void shelf.splice(index as number, 1),
          },
        ],
      }),
    );
    await wb.run("shelf.add", { item: "a" });
    await wb.run("shelf.add", { item: "b" });
    expect(shelf).toEqual(["a", "b"]);
    expect(wb.undo()?.commandId).toBe("shelf.add");
    expect(shelf).toEqual(["a"]);
    // Panels are untouched by undoing an app-data command.
    expect(Object.keys(wb.getDoc().instances)).toEqual(["note-1"]);
  });

  it("switches to a preset workspace and can undo the switch", async () => {
    const wb = new Werkbank(
      config(memoryStore(), {
        presets: {
          twin: {
            layout: { root: { type: "tabset", id: "root", tabs: [{ id: "note-a" }, { id: "note-b" }] } },
            instances: [{ id: "note-a", toolId: "note" }, { id: "note-b", toolId: "note" }],
          },
        },
      }),
    );
    expect(wb.commands.palette(wb).map((e) => e.title)).toContain("Preset workspace: twin");
    await wb.run("workspace.preset", { name: "twin" });
    expect(Object.keys(wb.getDoc().instances)).toEqual(["note-a", "note-b"]);
    expect(wb.getDoc().name).toBe("twin");
    wb.undo();
    expect(Object.keys(wb.getDoc().instances)).toEqual(["note-1"]);
  });
});

describe("state that belongs to the session", () => {
  it("follows the person into another workspace", async () => {
    const talk: ToolSpec<{ said: string[] }> = {
      id: "talk", title: "Talk", version: 1, keepAcrossWorkspaces: true,
      stateSchema: z.object({ said: z.array(z.string()) }), defaultState: () => ({ said: [] }),
    };
    const wb = new Werkbank(
      config(memoryStore(), {
        tools: [note, talk],
        defaultWorkspace: {
          layout: { root: { type: "tabset", id: "root", tabs: [{ id: "note-1" }, { id: "talk-1" }] } },
          instances: [{ id: "note-1", toolId: "note" }, { id: "talk-1", toolId: "talk" }],
        },
        presets: {
          other: {
            layout: { root: { type: "tabset", id: "root", tabs: [{ id: "note-9" }, { id: "talk-9" }] } },
            instances: [{ id: "note-9", toolId: "note" }, { id: "talk-9", toolId: "talk" }],
          },
        },
      }),
    );
    wb.setState("talk-1", { said: ["hello"] });
    wb.setState("note-1", { text: "stays behind" });
    await wb.run("workspace.preset", { name: "other" });
    expect(wb.getDoc().instances["talk-9"]!.state).toEqual({ said: ["hello"] });
    expect(wb.getDoc().instances["note-9"]!.state).toEqual({ text: "" });
  });
});

describe("settings", () => {
  const specs = [
    { key: "size", title: "Size", section: "Look", schema: z.number().int().min(1).max(9), default: 3 },
    { key: "mode", title: "Mode", section: "Look", schema: z.enum(["a", "b"]), default: "a" as const },
  ];

  it("apps add their own, with defaults, validation and sections", async () => {
    const wb = new Werkbank(config(memoryStore(), { settings: specs }));
    expect(wb.settings.get("size")).toBe(3);
    expect(wb.settings.sections()).toEqual(["Assistant", "Look"]);
    expect(await wb.run("settings.set", { key: "size", value: 5 })).toMatchObject({ ok: true });
    expect(await wb.run("settings.set", { key: "size", value: 50 })).toMatchObject({ ok: false });
    expect(await wb.run("settings.set", { key: "nope", value: 1 })).toMatchObject({ ok: false });
    expect(wb.settings.get("size")).toBe(5);
    wb.undo();
    expect(wb.settings.get("size")).toBe(3);
  });

  it("persist, and fall back to the default when a stored value no longer fits", () => {
    const store = memoryStore();
    new Werkbank(config(store, { settings: specs })).settings.set("size", 7);
    expect(new Werkbank(config(store, { settings: specs })).settings.get("size")).toBe(7);
    // The app narrows the range in a later version: the stored 7 is no longer valid.
    const narrowed = [{ ...specs[0]!, schema: z.number().int().min(1).max(5) }, specs[1]!];
    expect(new Werkbank(config(store, { settings: narrowed })).settings.get("size")).toBe(3);
  });
});

describe("custom elements", () => {
  const source = `<p id="x"></p><script>werkbank.panels().then(() => werkbank.call("query", {})); werkbank.onLink("symbol", () => {});</script>`;

  it("become tools marked (C), survive a reload, and their panels are restored", async () => {
    const store = memoryStore();
    const a = new Werkbank(config(store));
    expect(await a.run("custom.save", { id: "mine", title: "Mine", source })).toMatchObject({ ok: true });
    expect(a.tools.get("c-mine")).toMatchObject({ title: "Mine (C)", category: "Custom", personal: true });
    const panel = a.open("c-mine");
    a.flush();
    const b = new Werkbank(config(store));
    expect(b.tools.has("c-mine")).toBe(true);
    expect(b.getDoc().instances[panel]).toBeDefined();
    expect(b.elementOf("c-mine")!.revision).toBe(1);
  });

  it("saving again makes a new revision and a draft; undo restores the earlier one", async () => {
    const wb = new Werkbank(config());
    await wb.run("custom.save", { id: "mine", title: "Mine", source });
    wb.custom.markSubmitted("mine");
    await wb.run("custom.save", { id: "mine", title: "Mine 2", source: "<p>changed</p>" });
    expect(wb.custom.get("mine")).toMatchObject({ title: "Mine 2", revision: 2, status: "draft" });
    wb.undo();
    expect(wb.custom.get("mine")).toMatchObject({ title: "Mine", revision: 1, status: "submitted" });
  });

  it("deleting closes its panels; a bad id or empty source is refused", async () => {
    const wb = new Werkbank(config());
    await wb.run("custom.save", { id: "mine", title: "Mine", source });
    const panel = wb.open("c-mine");
    await wb.run("custom.delete", { id: "mine" });
    expect(wb.getDoc().instances[panel]).toBeUndefined();
    expect(wb.tools.has("c-mine")).toBe(false);
    expect(await wb.run("custom.save", { id: "Bad Id", title: "x", source })).toMatchObject({ ok: false });
    expect(await wb.run("custom.save", { id: "fine", title: "Fine", source: "" })).toMatchObject({ ok: false });
  });

  it("a submission names what the element uses, and agents need approval to send one", async () => {
    const sent: unknown[] = [];
    const wb = new Werkbank(config(memoryStore(), { version: "1.2.3", custom: { submit: async (s) => (sent.push(s), { url: "https://tracker.example/1" }) } }));
    await wb.run("custom.save", { id: "mine", title: "Mine", source });
    const byAgent = wb.run("custom.submit", { id: "mine" }, "agent");
    expect(wb.getMeta().pendingApproval?.commandId).toBe("custom.submit");
    wb.resolveApproval(false);
    expect(await byAgent).toMatchObject({ ok: false, code: "denied" });
    const result = await wb.run("custom.submit", { id: "mine", notes: "please review" });
    expect(result).toMatchObject({ ok: true, value: { url: "https://tracker.example/1", delivered: true } });
    expect(sent[0]).toMatchObject({ kind: "werkbank-element-submission", app: "test@1.2.3", notes: "please review", uses: { api: ["call", "onLink", "panels"], hostFunctions: ["query"] } });
    expect(wb.custom.get("mine")!.status).toBe("submitted");
  });

  it("elements shipped with the app are tools without the mark", () => {
    const shipped = { id: "shared", title: "Shared", description: "", source, author: "team", created: "2026-01-01", updated: "2026-01-01", revision: 1, status: "submitted" as const };
    const wb = new Werkbank(config(memoryStore(), { custom: { elements: [shipped] } }));
    expect(wb.tools.get("e-shared")).toMatchObject({ title: "Shared", category: "Elements", personal: false });
    expect(wb.elementOf("e-shared")!.id).toBe("shared");
  });
});

describe("assistant setup", () => {
  it("is generated from the app's own configuration", () => {
    const wb = new Werkbank(config(memoryStore(), { assistant: { serverName: "my app!", brief: "Be careful with the notes." } }));
    const setup = assistantSetup(wb, null);
    expect(setup.serverName).toBe("my-app-");
    expect(setup.connect.find((c) => c.id === "claude")!.text).toBe("claude mcp add --transport http my-app- http://127.0.0.1:8787/mcp");
    expect(setup.connect.find((c) => c.id === "codex")!.text).toBe("codex mcp add my-app- --url http://127.0.0.1:8787/mcp");
    expect(setup.prompt).toContain('"Test"');
    expect(setup.prompt).toContain("Be careful with the notes.");
    expect(setup.prompt).toContain("Note (note)");
    expect(setup.prompt).toContain("symbol");
  });

  it("uses the address the running bridge reports", () => {
    const wb = new Werkbank(config());
    const info = { version: "1", defaultAgent: "claude", agents: [], mcp: { url: "http://127.0.0.1:9000/mcp", port: 9000, stdio: { command: "node", args: ["x.js"] } } };
    const setup = assistantSetup(wb, info);
    expect(setup.connect[0]!.text).toContain("http://127.0.0.1:9000/mcp");
    expect(JSON.parse(setup.connect.find((c) => c.id === "stdio")!.text).mcpServers.test).toEqual({ command: "node", args: ["x.js"] });
  });

  it("finds the libraries an element asks for", async () => {
    const { librariesOf, scanElement } = await import("../src/core");
    const source = `<script src="lib:echarts"></script>\n<script src='lib:d3' ></script><script src="lib:echarts"></script><script src="https://cdn.example/x.js"></script><script>werkbank.call("bars", {})</script>`;
    expect(librariesOf(source)).toEqual(["echarts", "d3"]);
    expect(scanElement(source)).toEqual({ api: ["call"], hostFunctions: ["bars"], libraries: ["echarts", "d3"] });
  });

  it("gives every package and the framework constant one version", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { FRAMEWORK_VERSION } = await import("../src/core");
    const version = (path: string) => JSON.parse(readFileSync(join(__dirname, "../../..", path, "package.json"), "utf8")).version;
    expect(["packages/framework", "packages/bridge", "packages/chart-libraries", "."].map(version)).toEqual(Array(4).fill(FRAMEWORK_VERSION));
  });
});
