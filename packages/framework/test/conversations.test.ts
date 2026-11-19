import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ConversationStore, Werkbank, memoryStore, type KeyValueStore, type ToolSpec } from "../src/core";

const say = (store: ConversationStore, id: string, text: string, now = true) =>
  store.update(id, (c) => ({ ...c, messages: [...c.messages, { role: "user" as const, text }] }), now);
/** Timestamps are the tie-break between tabs, so tests that compare them must not run within one millisecond. */
const later = () => new Promise((resolve) => setTimeout(resolve, 3));

describe("conversation store", () => {
  it("keeps conversations across a reload, newest first", async () => {
    const storage = memoryStore();
    const store = new ConversationStore(storage, "app");
    const first = store.create({ title: "First", agent: "claude" });
    await later();
    const second = store.create({ title: "Second", agent: null });
    await later();
    say(store, first.id, "hello");
    const reloaded = new ConversationStore(storage, "app");
    expect(reloaded.list().map((c) => c.title)).toEqual(["First", "Second"]);
    expect(reloaded.get(first.id)).toMatchObject({ agent: "claude", messages: [{ role: "user", text: "hello" }] });
    expect(reloaded.get(second.id)!.messages).toEqual([]);
    expect(new ConversationStore(storage, "other-app").list()).toEqual([]);
  });

  it("gives the same list until something changes", () => {
    const store = new ConversationStore(memoryStore(), "app");
    const { id } = store.create({ title: "One", agent: null });
    const before = store.list();
    expect(store.list()).toBe(before);
    say(store, id, "x");
    expect(store.list()).not.toBe(before);
  });

  it("delays writes while a reply streams in, and writes on flush", () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStore();
      const store = new ConversationStore(storage, "app");
      const { id } = store.create({ title: "One", agent: null });
      const written = () => JSON.parse(storage.getItem(store.key)!).conversations[0].messages.length;
      for (let i = 0; i < 50; i++) say(store, id, `piece ${i}`, false);
      expect(store.get(id)!.messages).toHaveLength(50);
      expect(written()).toBe(0);
      vi.advanceTimersByTime(400);
      expect(written()).toBe(50);
      say(store, id, "last words", false);
      store.flush();
      expect(written()).toBe(51);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renames and deletes with what an undo needs", () => {
    const store = new ConversationStore(memoryStore(), "app");
    const { id } = store.create({ title: "Draft", agent: null });
    expect(store.rename(id, "  Final  ")).toBe("Draft");
    expect(store.get(id)!.title).toBe("Final");
    expect(() => store.rename(id, "   ")).toThrow();
    expect(() => store.rename("nope", "x")).toThrow();
    const removed = store.remove(id);
    expect(store.list()).toEqual([]);
    store.restore(removed);
    expect(store.get(id)!.title).toBe("Final");
  });

  it("merges what two tabs wrote instead of the last one winning", async () => {
    const storage = memoryStore();
    const tabA = new ConversationStore(storage, "app");
    const tabB = new ConversationStore(storage, "app");
    const a = tabA.create({ title: "From A", agent: null });
    const b = tabB.create({ title: "From B", agent: null }); // B never saw A's, and writes after it
    expect(new ConversationStore(storage, "app").list().map((c) => c.title).sort()).toEqual(["From A", "From B"]);
    tabA.refresh();
    expect(tabA.get(b.id)?.title).toBe("From B");
    await later();
    say(tabB, a.id, "newer in B"); // B took A's in when it wrote
    tabA.refresh();
    expect(tabA.get(a.id)!.messages).toHaveLength(1);
  });

  it("does not bring back a conversation another tab deleted", async () => {
    const storage = memoryStore();
    const tabA = new ConversationStore(storage, "app");
    const { id } = tabA.create({ title: "Shared", agent: null });
    const tabB = new ConversationStore(storage, "app");
    await later();
    tabA.remove(id);
    tabB.create({ title: "Other", agent: null }); // B still holds "Shared" and writes
    expect(tabB.get(id)).toBeUndefined();
    expect(new ConversationStore(storage, "app").list().map((c) => c.title)).toEqual(["Other"]);
    // Restoring it (an undo) brings it back for everyone.
    await later();
    tabA.restore({ id, title: "Shared", messages: [], sessionId: null, agent: null, updated: new Date().toISOString() });
    tabB.refresh();
    expect(tabB.get(id)?.title).toBe("Shared");
  });

  it("adopts conversations a panel used to hold, once, skipping broken ones", () => {
    const store = new ConversationStore(memoryStore(), "app");
    const old = [
      { id: "kept", title: "Earlier", messages: [{ role: "user", text: "hi" }], sessionId: "s1", agent: "claude", updated: "2026-01-01T00:00:00.000Z" },
      { id: "broken", title: 7 },
      "nonsense",
    ];
    expect(store.adopt(old)).toBe(1);
    expect(store.adopt(old)).toBe(0);
    expect(store.get("kept")).toMatchObject({ sessionId: "s1", agent: "claude" });
    expect(store.adopt(undefined)).toBe(0);
  });

  it("starts empty from unreadable storage and keeps working", () => {
    const storage = memoryStore();
    storage.setItem("app.conversations", "{not json");
    const store = new ConversationStore(storage, "app");
    expect(store.list()).toEqual([]);
    store.create({ title: "Fresh", agent: null });
    expect(new ConversationStore(storage, "app").list()).toHaveLength(1);
  });

  it("lets go of the oldest conversations when storage is full, and says so", async () => {
    const inner = memoryStore();
    let room = Infinity;
    const storage: KeyValueStore = { ...inner, setItem: (k, v) => { if (v.length > room) throw new Error("QuotaExceededError"); inner.setItem(k, v); } };
    const store = new ConversationStore(storage, "app");
    const old = store.create({ title: "Old", agent: null });
    say(store, old.id, "x".repeat(2000));
    await later();
    const recent = store.create({ title: "Recent", agent: null });
    room = 1500;
    say(store, recent.id, "short");
    expect(store.list().map((c) => c.title)).toEqual(["Recent"]);
    expect(store.health()).toMatchObject({ trimmed: 1, unsaved: false });
    room = 10;
    say(store, recent.id, "more");
    expect(store.health().unsaved).toBe(true);
    expect(store.get(recent.id)!.messages).toHaveLength(2); // still there for this page load
  });

  it("caps a conversation's length and a title's", () => {
    const store = new ConversationStore(memoryStore(), "app");
    const { id } = store.create({ title: "t".repeat(200), agent: null });
    expect(store.get(id)!.title).toHaveLength(80);
    store.update(id, (c) => ({ ...c, messages: Array.from({ length: 450 }, (_, i) => ({ role: "user" as const, text: String(i) })) }), true);
    expect(store.get(id)!.messages).toHaveLength(400);
    expect(store.get(id)!.messages[0]!.text).toBe("50");
  });

  describe("a second copy outside the browser", () => {
    /** A file, as the bridge would keep it. */
    const disk = (initial: string | null = null) => {
      const file = { text: initial, writes: 0, fail: null as string | null };
      return {
        file,
        mirror: {
          read: async () => file.text,
          write: async (text: string) => {
            if (file.fail) throw new Error(file.fail);
            file.text = text;
            file.writes++;
          },
        },
      };
    };
    const titles = (text: string | null) => (JSON.parse(text ?? "null")?.conversations ?? []).map((c: { title: string }) => c.title).sort();

    it("brings conversations into a browser that has never seen them, and takes this browser's out", async () => {
      const first = new ConversationStore(memoryStore(), "app");
      first.create({ title: "Made in the first browser", agent: null });
      const { file, mirror } = disk();
      await first.attach(mirror);
      expect(titles(file.text)).toEqual(["Made in the first browser"]);
      expect(first.health()).toMatchObject({ onDisk: true, diskError: null });

      const second = new ConversationStore(memoryStore(), "app"); // another browser, or the same one after its data was cleared
      second.create({ title: "Made in the second", agent: null });
      await second.attach(mirror);
      expect(second.list().map((c) => c.title).sort()).toEqual(["Made in the first browser", "Made in the second"]);
      expect(titles(file.text)).toEqual(["Made in the first browser", "Made in the second"]);
    });

    it("writes later changes there too, a moment later or on flush", async () => {
      vi.useFakeTimers();
      try {
        const store = new ConversationStore(memoryStore(), "app");
        const { file, mirror } = disk();
        await store.attach(mirror);
        const { id } = store.create({ title: "One", agent: null });
        expect(titles(file.text)).toEqual([]);
        await vi.advanceTimersByTimeAsync(1500);
        expect(titles(file.text)).toEqual(["One"]);
        const removed = store.remove(id);
        store.flush();
        await vi.advanceTimersByTimeAsync(0);
        expect(titles(file.text)).toEqual([]);
        expect(JSON.parse(file.text!).deleted[removed.id]).toBeTruthy(); // so another browser does not bring it back
      } finally {
        vi.useRealTimers();
      }
    });

    it("says when the copy cannot be written, keeps working, and recovers", async () => {
      const store = new ConversationStore(memoryStore(), "app");
      const { file, mirror } = disk();
      file.fail = "The folder is read-only.";
      store.create({ title: "Kept in the browser", agent: null });
      await store.attach(mirror);
      expect(store.health()).toMatchObject({ onDisk: false, diskError: "The folder is read-only." });
      expect(store.list()).toHaveLength(1);
      file.fail = null;
      await store.attach(mirror);
      expect(store.health()).toMatchObject({ onDisk: true, diskError: null });
      expect(titles(file.text)).toEqual(["Kept in the browser"]);
    });

    it("survives a file that is not what it should be", async () => {
      for (const broken of ["{not json", '{"version":9}', "[]"]) {
        const store = new ConversationStore(memoryStore(), "app");
        store.create({ title: "Mine", agent: null });
        const { file, mirror } = disk(broken);
        await store.attach(mirror);
        expect(store.list().map((c) => c.title)).toEqual(["Mine"]);
        // Unreadable text is reported and left alone; readable text of another shape is replaced.
        if (broken === "{not json") expect(store.health().diskError).toBeTruthy();
        else expect(titles(file.text)).toEqual(["Mine"]);
      }
    });

    it("stops writing there when detached, and leaves the copy alone", async () => {
      vi.useFakeTimers();
      try {
        const store = new ConversationStore(memoryStore(), "app");
        const { file, mirror } = disk();
        store.create({ title: "Before", agent: null });
        await store.attach(mirror);
        store.detach();
        store.create({ title: "After", agent: null });
        await vi.advanceTimersByTimeAsync(3000);
        expect(titles(file.text)).toEqual(["Before"]);
        expect(store.health().onDisk).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("lets the browser's copy be shorter when its storage is full", async () => {
      const inner = memoryStore();
      const storage: KeyValueStore = { ...inner, setItem: (k, v) => { if (v.length > 1500) throw new Error("QuotaExceededError"); inner.setItem(k, v); } };
      const store = new ConversationStore(storage, "app");
      const { file, mirror } = disk();
      await store.attach(mirror);
      const old = store.create({ title: "Old", agent: null });
      say(store, old.id, "x".repeat(2000));
      await later();
      store.create({ title: "Recent", agent: null });
      store.flush();
      await later();
      expect(store.list().map((c) => c.title)).toEqual(["Recent", "Old"]); // nothing is dropped
      expect(store.health()).toMatchObject({ trimmed: 0, unsaved: false });
      await store.attach(mirror);
      expect(titles(file.text)).toEqual(["Old", "Recent"]);
    });
  });

  it("takes over conversations an Assistant panel held in a saved workspace", () => {
    // What chatTool's state looks like to the core: which conversation is open, plus (from older versions) the conversations themselves.
    const chat: ToolSpec<{ active: string | null; conversations?: unknown[] }> = {
      id: "chat",
      title: "Assistant",
      version: 4,
      stateSchema: z.object({ active: z.string().nullable(), conversations: z.array(z.unknown()).optional() }),
      defaultState: () => ({ active: null }),
    };
    const old = { id: "old-1", title: "Earlier", messages: [{ role: "user", text: "hi" }], sessionId: null, agent: null, updated: "2026-01-01T00:00:00.000Z" };
    const storage = memoryStore();
    const wb = new Werkbank({
      appId: "test",
      title: "Test",
      tools: [chat],
      storage,
      defaultWorkspace: { layout: { root: { type: "tabset", id: "root", tabs: [{ id: "chat-1" }] } }, instances: [{ id: "chat-1", toolId: "chat", state: { active: "old-1", conversations: [old] } }] },
    });
    expect(wb.conversations.get("old-1")?.title).toBe("Earlier");
    expect(wb.getDoc().instances["chat-1"]!.state).toEqual({ active: "old-1" });
    // Importing such a workspace later does the same, and keeps what is already in the store.
    wb.conversations.create({ title: "Newer", agent: null });
    const doc = structuredClone(wb.getDoc());
    doc.instances["chat-1"]!.state = { active: null, conversations: [{ ...old, id: "old-2", title: "From a file" }] };
    wb.loadDoc(doc);
    expect(wb.conversations.list().map((c) => c.title).sort()).toEqual(["Earlier", "From a file", "Newer"]);
    expect(JSON.stringify(wb.getDoc())).not.toContain("From a file");
  });
});
