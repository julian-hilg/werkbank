import { describe, expect, it, vi } from "vitest";
import { MirroredStore, memoryStore, type KeyValueStore } from "../src/core";

/** A file, as the bridge would keep it. */
const disk = (initial: string | null = null) => {
  const file = { text: initial, fail: null as string | null };
  return {
    file,
    mirror: {
      read: async () => file.text,
      write: async (text: string) => {
        if (file.fail) throw new Error(file.fail);
        file.text = text;
      },
    },
  };
};
const entries = (text: string | null) => Object.fromEntries(Object.entries(JSON.parse(text ?? '{"entries":{}}').entries as Record<string, { value: string | null }>).map(([k, v]) => [k, v.value]));
/** A browser's storage can list its keys; the minimal interface cannot. */
const listable = (): KeyValueStore & Pick<Storage, "length" | "key"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k), get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null };
};
const later = () => new Promise((resolve) => setTimeout(resolve, 3));

describe("mirrored storage", () => {
  it("behaves like the storage underneath", () => {
    const base = memoryStore();
    const store = new MirroredStore(base, "app");
    store.setItem("app.settings", "{}");
    expect(store.getItem("app.settings")).toBe("{}");
    expect(base.getItem("app.settings")).toBe("{}");
    store.removeItem("app.settings");
    expect(store.getItem("app.settings")).toBeNull();
  });

  it("writes the app's keys to the second place, and only those", async () => {
    const store = new MirroredStore(memoryStore(), "app", (key) => key === "app.conversations");
    store.setItem("app.settings", '{"theme":"dark"}');
    store.setItem("app.conversations", "kept elsewhere");
    store.setItem("other-app.settings", "not ours");
    store.setItem("unrelated", "x");
    const { file, mirror } = disk();
    await store.attach(mirror);
    expect(entries(file.text)).toEqual({ "app.settings": '{"theme":"dark"}' });
    expect(store.health()).toEqual({ onDisk: true, error: null });
  });

  it("restores everything into a browser that held nothing, even over the defaults written while starting", async () => {
    const first = new MirroredStore(listable(), "app");
    first.setItem("app.workspace.current", "my layout");
    first.setItem("app.workspace.named.review", "saved one");
    first.setItem("app.settings", "mine");
    const { file, mirror } = disk();
    await first.attach(mirror);

    const base = listable();
    const fresh = new MirroredStore(base, "app");
    expect(fresh.startedEmpty).toBe(true);
    await later();
    fresh.setItem("app.workspace.current", "the default layout"); // the app saves its starting state before the file arrives
    const replaced = await fresh.attach(mirror);
    expect(replaced.sort()).toEqual(["app.settings", "app.workspace.current", "app.workspace.named.review"]);
    expect(base.getItem("app.workspace.current")).toBe("my layout");
    expect(base.getItem("app.workspace.named.review")).toBe("saved one");
    expect(entries(file.text)["app.workspace.current"]).toBe("my layout");
  });

  it("lets the newer value win key by key once both sides have history", async () => {
    const { file, mirror } = disk();
    const a = new MirroredStore(listable(), "app");
    a.setItem("app.settings", "old settings");
    a.setItem("app.workspace.current", "layout from A");
    await a.attach(mirror);

    const baseB = listable();
    baseB.setItem("app.settings", "older still"); // B already had data: it is not a fresh browser
    const b = new MirroredStore(baseB, "app");
    expect(b.startedEmpty).toBe(false);
    expect(await b.attach(mirror)).toEqual(["app.settings", "app.workspace.current"]); // A's are newer than B's undated ones
    await later();
    b.setItem("app.settings", "newest, from B");
    b.flush();
    await later();
    expect(await a.attach(mirror)).toEqual(["app.settings"]);
    expect(a.getItem("app.settings")).toBe("newest, from B");
    expect(a.getItem("app.workspace.current")).toBe("layout from A");
    expect(entries(file.text)).toEqual({ "app.settings": "newest, from B", "app.workspace.current": "layout from A" });
  });

  it("carries a removal across instead of bringing the value back", async () => {
    const { file, mirror } = disk();
    const a = new MirroredStore(listable(), "app");
    a.setItem("app.workspace.named.old", "x");
    await a.attach(mirror);
    const baseB = listable();
    baseB.setItem("app.settings", "s");
    const b = new MirroredStore(baseB, "app");
    await b.attach(mirror);
    expect(b.getItem("app.workspace.named.old")).toBe("x");
    await later();
    a.removeItem("app.workspace.named.old");
    a.flush();
    await later();
    expect(entries(file.text)["app.workspace.named.old"]).toBeNull();
    expect(await b.attach(mirror)).toEqual(["app.workspace.named.old"]);
    expect(b.getItem("app.workspace.named.old")).toBeNull();
  });

  it("writes changes a moment later, and stops when detached", async () => {
    vi.useFakeTimers();
    try {
      const store = new MirroredStore(memoryStore(), "app");
      const { file, mirror } = disk();
      await store.attach(mirror);
      store.setItem("app.settings", "one");
      expect(entries(file.text)).toEqual({});
      await vi.advanceTimersByTimeAsync(1600);
      expect(entries(file.text)).toEqual({ "app.settings": "one" });
      store.detach();
      store.setItem("app.settings", "two");
      await vi.advanceTimersByTimeAsync(4000);
      expect(entries(file.text)).toEqual({ "app.settings": "one" });
      expect(store.health().onDisk).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when the second place cannot be written or read, and keeps working", async () => {
    const store = new MirroredStore(memoryStore(), "app");
    store.setItem("app.settings", "kept here");
    const failing = disk();
    failing.file.fail = "The folder is read-only.";
    await store.attach(failing.mirror);
    expect(store.health()).toEqual({ onDisk: false, error: "The folder is read-only." });
    expect(store.getItem("app.settings")).toBe("kept here");
    for (const broken of ["{not json", '{"version":2,"entries":{}}', "[]", '{"version":1,"entries":{"app.settings":{"value":7,"updated":"x"},"evil.key":{"value":"x","updated":"2999-01-01T00:00:00.000Z"}}}']) {
      const again = new MirroredStore(memoryStore(), "app");
      again.setItem("app.settings", "mine");
      await again.attach(disk(broken).mirror);
      expect(again.getItem("app.settings")).toBe("mine");
      expect(again.getItem("evil.key")).toBeNull();
    }
  });
});
