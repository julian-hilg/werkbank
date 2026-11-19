import { z } from "zod";
import type { KeyValueStore } from "./storage";

/**
 * The assistant's conversations. They belong to the person and the app, not to
 * a panel or a workspace: closing the Assistant panel, switching workspace or
 * importing one leaves them alone, and a workspace file never contains them.
 *
 * Kept in the app's storage under one key, and, when the app has a folder of
 * its own on this machine (see `attach`), in a file there as well, so they
 * also survive the browser's data being cleared, another browser, and a
 * change of the app's address. Several tabs of the same app share
 * it: every write first takes in what the other tabs wrote, the newer copy of
 * a conversation wins, and a deletion is remembered so that it is not undone
 * by a tab that still holds the conversation.
 */
export const conversationMessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool", "error"]),
  text: z.string(),
  /** For tool rows: whether the call succeeded, once known. */
  ok: z.boolean().optional(),
  /** True while the agent is still writing this message. */
  streaming: z.boolean().optional(),
  /** On a message the person sent: the panels whose data went along with it, by title. */
  attached: z.array(z.string()).max(12).optional(),
  /** On a reply: the action-history entries the agent made while answering, so they can be undone together. */
  actions: z.array(z.number()).max(200).optional(),
});
export const conversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(80),
  messages: z.array(conversationMessageSchema),
  /** The agent's own conversation id, so follow-up messages keep their context. */
  sessionId: z.string().nullable(),
  /** The agent that session belongs to. A session cannot continue with a different agent. */
  agent: z.string().nullable(),
  /** When it was last changed (ISO). The newer copy wins when two tabs disagree. */
  updated: z.string(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;

export const CONVERSATION_LIMITS = { conversations: 100, messages: 400, title: 80 } as const;

const storedSchema = z.object({
  version: z.literal(1),
  conversations: z.array(z.unknown()),
  /** Deleted conversation ids and when they were deleted. */
  deleted: z.record(z.string(), z.string()).default({}),
});
const REMEMBERED_DELETIONS = 300;
const SAVE_DELAY = 300;
const MIRROR_DELAY = 1200;

/**
 * A second place the conversations are kept, outside the browser: in practice a file in the app's
 * folder, read and written through the agent bridge. Both sides hold the same text format.
 */
export interface ConversationMirror {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}
type Stored = { conversations: Conversation[]; deleted: Record<string, string> };

type Listener = () => void;

export class ConversationStore {
  /** The storage key, so a page can watch it for changes made in other tabs. */
  readonly key: string;
  private items: Conversation[] = [];
  private deleted: Record<string, string> = {};
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private trimmed = 0;
  private unsaved = false;
  private mirror: ConversationMirror | null = null;
  private mirrorTimer: ReturnType<typeof setTimeout> | null = null;
  private mirrorBusy: Promise<void> | null = null;
  private mirrored: string | null = null;
  private mirrorError: string | null = null;
  private lastStamp = "";

  constructor(
    private store: KeyValueStore,
    appId: string,
  ) {
    this.key = `${appId}.conversations`;
    this.merge(this.read());
  }

  /** All conversations, most recently changed first. The same array until something changes. */
  list = (): Conversation[] => this.items;
  get = (id: string | null | undefined): Conversation | undefined => (id ? this.items.find((c) => c.id === id) : undefined);
  subscribe = (fn: Listener) => (this.listeners.add(fn), () => void this.listeners.delete(fn));
  /** What a person should know about storage: conversations dropped because it was full, or not being saved at all. */
  health = (): { trimmed: number; unsaved: boolean; onDisk: boolean; diskError: string | null } => ({ trimmed: this.trimmed, unsaved: this.unsaved && !this.mirror, onDisk: Boolean(this.mirror) && !this.mirrorError, diskError: this.mirrorError });

  /**
   * Keep the conversations in a second place as well. What is there is taken in first (so a browser
   * that has never seen them gets them), then every change is written to both.
   */
  async attach(mirror: ConversationMirror): Promise<void> {
    this.mirror = mirror;
    this.mirrored = null;
    await this.pushToMirror();
  }

  /** Stop using the second place. What is in it stays there. */
  detach(): void {
    if (this.mirrorTimer !== null) clearTimeout(this.mirrorTimer);
    this.mirrorTimer = null;
    this.mirror = null;
    this.mirrorError = null;
    this.listeners.forEach((fn) => fn());
  }

  create(init: { title: string; agent: string | null; id?: string }): Conversation {
    const conversation: Conversation = { id: init.id ?? crypto.randomUUID(), title: init.title.slice(0, CONVERSATION_LIMITS.title), messages: [], sessionId: null, agent: init.agent, updated: this.stamp() };
    this.commit([conversation, ...this.items.filter((c) => c.id !== conversation.id)], true);
    return conversation;
  }

  /**
   * Change one conversation. Called for every piece of a reply as it streams in, so the write to
   * storage is delayed and merged; pass `now` for changes that must not be lost (a sent message).
   */
  update(id: string, change: (conversation: Conversation) => Conversation, now = false): Conversation | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const changed = change(current);
    const next: Conversation = { ...changed, id, title: changed.title.slice(0, CONVERSATION_LIMITS.title), messages: changed.messages.slice(-CONVERSATION_LIMITS.messages), updated: this.stamp() };
    this.commit([next, ...this.items.filter((c) => c.id !== id)], now);
    return next;
  }

  /** Returns the title it had, so the change can be undone. */
  rename(id: string, title: string): string {
    const current = this.get(id);
    if (!current) throw new Error(`Unknown conversation: ${id}`);
    const clean = title.trim();
    if (!clean) throw new Error("A conversation needs a name.");
    this.update(id, (c) => ({ ...c, title: clean }), true);
    return current.title;
  }

  /** Returns the removed conversation, so it can be put back. */
  remove(id: string): Conversation {
    const current = this.get(id);
    if (!current) throw new Error(`Unknown conversation: ${id}`);
    this.deleted = { ...this.deleted, [id]: this.stamp() };
    this.commit(this.items.filter((c) => c.id !== id), true);
    return current;
  }

  /** Remove every conversation. Returns them, so they can be put back. */
  clear(): Conversation[] {
    const all = this.items;
    const when = this.stamp();
    this.deleted = { ...this.deleted, ...Object.fromEntries(all.map((c) => [c.id, when])) };
    this.commit([], true);
    return all;
  }

  /** Put a removed conversation back (used by undo). */
  restore(conversation: Conversation): void {
    const { [conversation.id]: _gone, ...deleted } = this.deleted;
    this.deleted = deleted;
    this.commit([{ ...conversation, updated: this.stamp() }, ...this.items.filter((c) => c.id !== conversation.id)], true);
  }

  /**
   * Take in conversations from somewhere else, for example the ones an Assistant panel held in
   * its own state before this store existed. Ones already here are left alone. Returns how many came in.
   */
  adopt(candidates: unknown): number {
    const incoming = parseAll(candidates).filter((c) => !this.get(c.id) && !this.deleted[c.id]);
    if (incoming.length) this.commit([...this.items, ...incoming], true);
    return incoming.length;
  }

  /** Take in what another tab of the app wrote. Call it when the storage key changes, or to be sure before reading. */
  refresh(): void {
    if (this.merge(this.read())) this.listeners.forEach((fn) => fn());
  }

  /** Write now what is waiting to be written, for example when the page is being closed. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.write();
    }
    if (this.mirrorTimer !== null) {
      clearTimeout(this.mirrorTimer);
      this.mirrorTimer = null;
      void this.pushToMirror();
    }
  }

  // ---- internals ----------------------------------------------------------

  /** The time of a change. Always later than the one before, so two changes within a millisecond still have an order. */
  private stamp(): string {
    const now = new Date().toISOString();
    this.lastStamp = now > this.lastStamp ? now : new Date(new Date(this.lastStamp).getTime() + 1).toISOString();
    return this.lastStamp;
  }

  private commit(items: Conversation[], now: boolean): void {
    this.items = order(items).slice(0, CONVERSATION_LIMITS.conversations);
    if (now) {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.write();
    } else if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.write();
        // Writing may have taken in another tab's changes.
        this.listeners.forEach((fn) => fn());
      }, SAVE_DELAY);
    }
    this.listeners.forEach((fn) => fn());
  }

  private read(): Stored | null {
    try {
      return parseStored(this.store.getItem(this.key));
    } catch {
      return null;
    }
  }

  private serialise(items = this.items): string {
    return JSON.stringify({ version: 1, conversations: items, deleted: this.deleted });
  }

  /** Take in what the second place holds, then write the union there. One at a time; a change made meanwhile goes out next. */
  private pushToMirror(): Promise<void> {
    const mirror = this.mirror;
    if (!mirror) return Promise.resolve();
    if (this.mirrorBusy) return this.mirrorBusy.then(() => (this.mirror === mirror && this.serialise() !== this.mirrored ? this.pushToMirror() : undefined));
    const work = (async () => {
      try {
        const theirs = await mirror.read();
        if (this.mirror !== mirror) return;
        if (this.merge(theirs === null ? null : parseStored(theirs))) {
          this.writeLocal();
          this.listeners.forEach((fn) => fn());
        }
        const text = this.serialise();
        if (text !== theirs) await mirror.write(text);
        if (this.mirror !== mirror) return;
        this.mirrored = text;
        if (this.mirrorError) {
          this.mirrorError = null;
          this.listeners.forEach((fn) => fn());
        }
      } catch (error) {
        if (this.mirror !== mirror) return;
        const message = error instanceof Error ? error.message : String(error);
        if (message !== this.mirrorError) {
          this.mirrorError = message;
          this.listeners.forEach((fn) => fn());
        }
      }
    })();
    this.mirrorBusy = work.finally(() => {
      this.mirrorBusy = null;
    });
    return this.mirrorBusy;
  }

  /** Union of ours and theirs: the newer copy of each conversation, minus those deleted after their last change. */
  private merge(theirs: { conversations: Conversation[]; deleted: Record<string, string> } | null): boolean {
    if (!theirs) return false;
    const deleted: Record<string, string> = { ...theirs.deleted };
    for (const [id, when] of Object.entries(this.deleted)) if (!deleted[id] || deleted[id] < when) deleted[id] = when;
    const byId = new Map<string, Conversation>();
    // Ours come second and win a tie: what this page just did must not be undone by an equally old copy.
    for (const c of [...theirs.conversations, ...this.items]) {
      const other = byId.get(c.id);
      if (!other || other.updated <= c.updated) byId.set(c.id, c);
    }
    const merged = order([...byId.values()].filter((c) => !deleted[c.id] || deleted[c.id]! < c.updated)).slice(0, CONVERSATION_LIMITS.conversations);
    const before = JSON.stringify([this.items, this.deleted]);
    this.items = merged;
    this.deleted = Object.fromEntries(Object.entries(deleted).sort((a, b) => b[1].localeCompare(a[1])).slice(0, REMEMBERED_DELETIONS));
    return JSON.stringify([this.items, this.deleted]) !== before;
  }

  private write(): void {
    this.merge(this.read());
    this.writeLocal();
    if (this.mirror && this.mirrorTimer === null) {
      this.mirrorTimer = setTimeout(() => {
        this.mirrorTimer = null;
        void this.pushToMirror();
      }, MIRROR_DELAY);
    }
  }

  private writeLocal(): void {
    // If storage is full, let go of the oldest conversations rather than of the one being written.
    for (let keep = this.items.length; ; keep--) {
      try {
        this.store.setItem(this.key, this.serialise(this.items.slice(0, keep)));
        // With a second place holding everything, the browser's copy may simply be shorter.
        if (keep < this.items.length && !this.mirror) {
          this.trimmed += this.items.length - keep;
          this.items = this.items.slice(0, keep);
        }
        this.unsaved = false;
        return;
      } catch {
        if (keep <= 1) {
          this.unsaved = true; // they then last for this page load only
          return;
        }
      }
    }
  }
}

/** Read the stored text format. Throws on text that is not JSON; returns null for JSON that is something else. */
function parseStored(text: string | null): Stored | null {
  const stored = storedSchema.safeParse(JSON.parse(text ?? "null"));
  return stored.success ? { conversations: parseAll(stored.data.conversations), deleted: stored.data.deleted } : null;
}

const order = (items: Conversation[]) => [...items].sort((a, b) => b.updated.localeCompare(a.updated));

/** The valid conversations in a list of unknown values; one bad entry does not cost the others. */
function parseAll(candidates: unknown): Conversation[] {
  if (!Array.isArray(candidates)) return [];
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const parsed = conversationSchema.safeParse(candidate);
    if (!parsed.success || seen.has(parsed.data.id)) return [];
    seen.add(parsed.data.id);
    return [{ ...parsed.data, messages: parsed.data.messages.slice(-CONVERSATION_LIMITS.messages) }];
  });
}
