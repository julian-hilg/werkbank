import type { KeyValueStore } from "./storage";

/**
 * The app's storage, kept in a second place as well. What an app stores under
 * its own name (workspaces, settings, custom elements) normally lives in one
 * browser at one address. With a mirror attached (in practice a file in the
 * app's folder, written through the agent bridge) it also survives the
 * browser's data being cleared, another browser and a change of address.
 *
 * Every key carries the time it was last written. When the two places
 * disagree, the newer value wins, key by key; a removal is a value too.
 * Conversations are not handled here: they have a store that merges them one
 * by one (see conversations.ts).
 */
export interface StorageMirror {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

type Entry = { value: string | null; updated: string };
const PUSH_DELAY = 1500;
/** Keys that existed before anything was recorded about them: older than any real change. */
const UNKNOWN_AGE = "1970-01-01T00:00:00.000Z";

export class MirroredStore implements KeyValueStore {
  private stamps: Record<string, string> = {};
  private mirror: StorageMirror | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy: Promise<void> | null = null;
  private error: string | null = null;
  private synced = false;
  private listeners = new Set<() => void>();
  private readonly prefix: string;
  private readonly stampsKey: string;
  /** True when this browser held nothing of the app's when the page loaded. */
  readonly startedEmpty: boolean;

  /** `skip` names keys of the app that are kept elsewhere. */
  constructor(
    private base: KeyValueStore,
    appId: string,
    private skip: (key: string) => boolean = () => false,
  ) {
    this.prefix = `${appId}.`;
    this.stampsKey = `${appId}.sync`;
    try {
      const stored = JSON.parse(base.getItem(this.stampsKey) ?? "{}");
      if (stored && typeof stored === "object") for (const [key, at] of Object.entries(stored)) if (typeof at === "string" && this.tracked(key)) this.stamps[key] = at;
    } catch {
      /* start without history; existing keys count as old */
    }
    for (const key of this.existingKeys()) this.stamps[key] ??= UNKNOWN_AGE;
    this.startedEmpty = Object.keys(this.stamps).every((key) => this.base.getItem(key) === null);
  }

  getItem(key: string): string | null {
    return this.base.getItem(key);
  }
  setItem(key: string, value: string): void {
    this.base.setItem(key, value);
    this.touched(key);
  }
  removeItem(key: string): void {
    this.base.removeItem(key);
    this.touched(key);
  }

  subscribe = (fn: () => void) => (this.listeners.add(fn), () => void this.listeners.delete(fn));
  health = (): { onDisk: boolean; error: string | null } => ({ onDisk: Boolean(this.mirror) && !this.error, error: this.error });

  /**
   * Keep everything in a second place as well. Returns the keys whose value in this browser was
   * replaced by a newer one from there; the running app has not seen those yet.
   */
  async attach(mirror: StorageMirror): Promise<string[]> {
    this.mirror = mirror;
    return this.sync();
  }

  detach(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.mirror = null;
    this.error = null;
    this.listeners.forEach((fn) => fn());
  }

  /** Write now what is waiting to be written. */
  flush(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    void this.sync();
  }

  // ---- internals ----------------------------------------------------------

  private tracked(key: string): boolean {
    return key.startsWith(this.prefix) && key !== this.stampsKey && !this.skip(key);
  }

  /** The app's keys in the underlying storage, where it can list them (a browser's can). */
  private existingKeys(): string[] {
    const listable = this.base as Partial<Pick<Storage, "length" | "key">>;
    if (typeof listable.length !== "number" || typeof listable.key !== "function") return [];
    const keys: string[] = [];
    for (let i = 0; i < listable.length; i++) {
      const key = listable.key(i);
      if (key && this.tracked(key)) keys.push(key);
    }
    return keys;
  }

  private touched(key: string): void {
    if (!this.tracked(key)) return;
    const now = new Date().toISOString();
    const last = this.stamps[key];
    // Always later than the write before, so two writes within a millisecond keep their order.
    this.stamps[key] = !last || now > last ? now : new Date(new Date(last).getTime() + 1).toISOString();
    this.saveStamps();
    if (this.mirror && this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.sync();
      }, PUSH_DELAY);
    }
  }

  private saveStamps(): void {
    try {
      this.base.setItem(this.stampsKey, JSON.stringify(this.stamps));
    } catch {
      /* without them, this browser's values count as old next time */
    }
  }

  private snapshot(): string {
    const entries: Record<string, Entry> = {};
    for (const key of Object.keys(this.stamps).sort()) entries[key] = { value: this.base.getItem(key), updated: this.stamps[key]! };
    return JSON.stringify({ version: 1, entries });
  }

  /** Take in what is newer in the second place, then write the union there. One at a time. */
  private sync(): Promise<string[]> {
    const mirror = this.mirror;
    if (!mirror) return Promise.resolve([]);
    if (this.busy) return this.busy.then(() => (this.mirror === mirror ? this.sync() : []));
    let replaced: string[] = [];
    const work = (async () => {
      try {
        const theirs = await mirror.read();
        if (this.mirror !== mirror) return;
        // A browser that held nothing has only the defaults the app wrote while starting: what was kept wins over those.
        replaced = this.takeIn(theirs, this.startedEmpty && !this.synced);
        this.synced = true;
        const text = this.snapshot();
        if (text !== theirs) await mirror.write(text);
        if (this.mirror !== mirror) return;
        if (this.error) {
          this.error = null;
          this.listeners.forEach((fn) => fn());
        }
      } catch (error) {
        if (this.mirror !== mirror) return;
        const message = error instanceof Error ? error.message : String(error);
        if (message !== this.error) {
          this.error = message;
          this.listeners.forEach((fn) => fn());
        }
      }
    })();
    this.busy = work.finally(() => {
      this.busy = null;
    });
    return this.busy.then(() => replaced);
  }

  private takeIn(text: string | null, theirsWin = false): string[] {
    if (text === null) return [];
    const parsed = JSON.parse(text) as { version?: unknown; entries?: unknown };
    if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") return [];
    const replaced: string[] = [];
    for (const [key, entry] of Object.entries(parsed.entries as Record<string, Partial<Entry>>)) {
      if (!this.tracked(key) || typeof entry?.updated !== "string" || !(entry.value === null || typeof entry.value === "string")) continue;
      const ours = this.stamps[key];
      if (!theirsWin && ours !== undefined && ours >= entry.updated) continue;
      this.stamps[key] = entry.updated;
      if (this.base.getItem(key) === entry.value) continue;
      try {
        if (entry.value === null) this.base.removeItem(key);
        else this.base.setItem(key, entry.value);
        replaced.push(key);
      } catch {
        delete this.stamps[key]; // no room here: leave the newer value where it is
      }
    }
    if (replaced.length) this.saveStamps();
    return replaced;
  }
}
