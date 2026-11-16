import {
  DOC_SCHEMA,
  LIMITS,
  WorkspaceDocSchema,
  defaultShell,
  emptyLayout,
  type Instance,
  type Layout,
  type WorkspaceDoc,
} from "./document";
import { filterTabs, tabIds } from "./layout-model";
import type { ToolSpec } from "./werkbank";

/** Minimal key-value store; `localStorage` satisfies it. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const memoryStore = (): KeyValueStore => {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

/** A workspace as a project declares it: only what differs from defaults. */
export interface WorkspaceSeed {
  name?: string;
  layout: Layout;
  instances: (Pick<Instance, "id" | "toolId"> & Partial<Pick<Instance, "state" | "link" | "local" | "title">>)[];
  links?: WorkspaceDoc["links"];
  shell?: Partial<WorkspaceDoc["shell"]>;
}

export function docFromSeed(seed: WorkspaceSeed, appId: string, theme: string): unknown {
  return {
    schema: DOC_SCHEMA,
    appId,
    name: seed.name ?? "default",
    layout: seed.layout,
    instances: Object.fromEntries(
      seed.instances.map((i) => [
        i.id,
        { id: i.id, toolId: i.toolId, version: -1, state: i.state, link: i.link ?? null, local: i.local ?? {}, title: i.title },
      ]),
    ),
    links: seed.links ?? {},
    shell: { ...defaultShell(theme), ...seed.shell },
  };
}

export interface Normalised {
  doc: WorkspaceDoc;
  /** Human-readable notes about anything that was repaired or dropped. */
  notes: string[];
}

/**
 * Validate an untrusted document and repair what can be repaired:
 * unknown tools and orphan tabs are dropped, tool state is validated,
 * migrated or reset. Returns null when the document is not usable at all.
 */
export function normaliseDoc(
  raw: unknown,
  tools: ReadonlyMap<string, ToolSpec<any>>,
  appId: string,
): Normalised | null {
  const parsed = WorkspaceDocSchema.safeParse(raw);
  if (!parsed.success) return null;
  const input = parsed.data;
  const notes: string[] = [];
  const instances: Record<string, Instance> = {};
  const inLayout = new Set(tabIds(input.layout));

  for (const [key, inst] of Object.entries(input.instances)) {
    const tool = tools.get(inst.toolId);
    if (key !== inst.id) {
      notes.push(`Dropped panel with mismatched id "${key}".`);
    } else if (!tool) {
      notes.push(`Dropped panel "${inst.id}": unknown tool "${inst.toolId}".`);
    } else if (!inLayout.has(inst.id)) {
      notes.push(`Dropped panel "${inst.id}": not in the layout.`);
    } else if (Object.keys(instances).length >= LIMITS.instances) {
      notes.push(`Dropped panel "${inst.id}": over the ${LIMITS.instances}-panel limit.`);
    } else {
      let candidate = inst.state;
      if (inst.version !== tool.version && tool.migrate) candidate = tool.migrate(candidate, inst.version);
      const state = tool.stateSchema.safeParse(candidate === undefined ? tool.defaultState() : candidate);
      if (!state.success) notes.push(`Reset state of "${inst.id}": it did not match the ${tool.id} schema.`);
      instances[inst.id] = {
        ...inst,
        version: tool.version,
        state: state.success ? state.data : tool.defaultState(),
      };
    }
  }

  const seen = new Set<string>();
  const layout = filterTabs(input.layout, (tab) => {
    if (!instances[tab.id] || seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
  if (inLayout.size !== seen.size) notes.push("Removed tabs without a matching panel.");

  return { doc: { ...input, appId, layout, instances }, notes };
}

export const emptyDoc = (appId: string, theme: string): WorkspaceDoc => ({
  schema: DOC_SCHEMA,
  appId,
  name: "default",
  layout: emptyLayout(),
  instances: {},
  links: {},
  shell: defaultShell(theme),
});

export type LoadSource = "saved" | "last-good" | "default";

/** Persistence with a last-good copy, so one bad write never loses a workspace. */
export class WorkspaceStorage {
  constructor(
    private store: KeyValueStore,
    private appId: string,
  ) {}

  private key = (suffix: string) => `${this.appId}.workspace.${suffix}`;

  private read(suffix: string): unknown {
    try {
      const text = this.store.getItem(this.key(suffix));
      return text === null ? undefined : JSON.parse(text);
    } catch {
      return null;
    }
  }

  /** Raw candidates in order of preference. `null` marks an unreadable entry. */
  candidates(): { source: LoadSource; raw: unknown }[] {
    return [
      { source: "saved" as const, raw: this.read("current") },
      { source: "last-good" as const, raw: this.read("last-good") },
    ].filter((c) => c.raw !== undefined);
  }

  /** Keep a rejected primary for inspection instead of overwriting it silently. */
  quarantine(): void {
    const text = this.store.getItem(this.key("current"));
    if (text !== null) this.trySet("rejected", text);
  }

  saveCurrent(doc: WorkspaceDoc): boolean {
    const text = JSON.stringify(doc);
    if (new TextEncoder().encode(text).length > LIMITS.bytes) return false;
    const previous = this.store.getItem(this.key("current"));
    if (previous !== null && WorkspaceDocSchema.safeParse(safeJson(previous)).success) {
      this.trySet("last-good", previous);
    }
    return this.trySet("current", text);
  }

  names(): string[] {
    const raw = this.read("names");
    return Array.isArray(raw) ? raw.filter((n): n is string => typeof n === "string") : [];
  }

  saveNamed(name: string, doc: WorkspaceDoc): boolean {
    if (!this.trySet(`named.${name}`, JSON.stringify({ ...doc, name }))) return false;
    const names = this.names();
    if (!names.includes(name)) this.trySet("names", JSON.stringify([...names, name].sort()));
    return true;
  }

  loadNamed(name: string): unknown {
    return this.read(`named.${name}`);
  }

  deleteNamed(name: string): void {
    this.store.removeItem(this.key(`named.${name}`));
    this.trySet("names", JSON.stringify(this.names().filter((n) => n !== name)));
  }

  private trySet(suffix: string, text: string): boolean {
    try {
      this.store.setItem(this.key(suffix), text);
      return true;
    } catch {
      return false;
    }
  }
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
