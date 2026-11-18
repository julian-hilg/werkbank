import {
  CommandRegistry,
  needsApproval,
  type Actor,
  type Command,
  type CommandResult,
} from "./commands";
import { LIMITS, LINK_GROUPS, type Instance, type Layout, type LayoutTab, type WorkspaceDoc } from "./document";
import { filterTabs, mergeTabs, outline, tabIds, tabsetOf, tabsets } from "./layout-model";
import {
  WorkspaceStorage,
  docFromSeed,
  emptyDoc,
  memoryStore,
  normaliseDoc,
  type KeyValueStore,
  type LoadSource,
  type WorkspaceSeed,
} from "./storage";
import { registerBuiltins } from "./builtin-commands";
import { CustomElementStore, scanElement, type CustomElement, type ElementSubmission } from "./custom";
import { SettingsStore, type SettingSpec } from "./settings";
import { z } from "zod";

export type Direction = "left" | "right" | "up" | "down";
export type Region = "left" | "right" | "top" | "bottom" | "center";
export type DropTarget =
  | { tabsetId: string; index: number }
  | { tabsetId: string; region: Region }
  | { edge: "left" | "right" | "top" | "bottom" };

/**
 * What the core needs from a layout engine. `layout/` implements it on
 * react-resizable-panels; `MemoryEngine` implements it for tests.
 */
export interface LayoutEngine {
  /** Current main layout, plus tabs living in popout windows. */
  snapshot(): { layout: Layout; detached: LayoutTab[] };
  setLayout(layout: Layout): void;
  addTab(tab: LayoutTab, target?: DropTarget): boolean;
  closeTab(id: string): void;
  selectTab(id: string): void;
  moveTab(id: string, target: DropTarget): void;
  retitle(id: string, title: string): void;
  toggleMaximize(tabsetId: string): void;
  floatTab(id: string): void;
  popout(id: string): boolean;
  activeTabsetId(): string | undefined;
  /** Tabset next to the given one on screen, if any. */
  neighbour(tabsetId: string, direction: Direction): string | undefined;
  focusTabset(tabsetId: string): void;
}

export interface DescribeContext {
  instance: Instance;
  /** Resolved topic values for this panel (from its link group or its own). */
  links: Record<string, unknown>;
}

/** The React-free part of a tool definition. */
export interface ToolSpec<S> {
  id: string;
  title: string;
  /** One or two characters shown in the rail and tool list. */
  glyph?: string;
  /** Heading the tool is listed under in the Tools view. */
  category?: string;
  /**
   * Keep this tool's state when the workspace is replaced (a preset, a saved
   * workspace, a reset). For panels whose content belongs to the session
   * rather than to one layout, such as a conversation.
   */
  keepAcrossWorkspaces?: boolean;
  /** Set on tools that are custom elements: the element's id. The panel host renders these in a sandbox. */
  element?: string;
  /** True for an element the person made themselves (as opposed to one shipped with the app). */
  personal?: boolean;
  /** Bump when `stateSchema` changes shape; `migrate` upgrades older state. */
  version: number;
  stateSchema: z.ZodType<S>;
  defaultState: () => S;
  migrate?: (state: unknown, fromVersion: number) => unknown;
  /** Topics this tool reads or publishes. */
  links?: string[];
  /** What an agent sees instead of pixels: the data behind the view. */
  describe?: (state: S, ctx: DescribeContext) => unknown;
  commands?: Command<Werkbank, any>[];
}

export interface WerkbankConfig {
  appId: string;
  /** The app's name. Set here, in code: it is the app's identity, not a preference. */
  title: string;
  /**
   * The app's logo: a URL (or data URL) of a small square image, shown at the top of the rail,
   * in the settings window and as the page icon. Like the title it is fixed by the app; the
   * person can only choose whether it is shown (Settings → Appearance).
   */
  logo?: string;
  /** Pages about this app for the settings window's Documentation section. They come before the framework's own. */
  docs?: { id: string; title: string; text: string }[];
  tools: ToolSpec<any>[];
  /** Schemas for link topics; published values are validated against them. */
  topics?: Record<string, z.ZodType>;
  defaultWorkspace: WorkspaceSeed;
  /** Further ready-made workspaces the person can switch to by name. */
  presets?: Record<string, WorkspaceSeed>;
  themes?: string[];
  commands?: Command<Werkbank, any>[];
  storage?: KeyValueStore;
  /** The app's own version, shown in settings and sent with element submissions. */
  version?: string;
  /** Settings this app adds to the framework's own. */
  settings?: SettingSpec<any>[];
  /** How an external agent is told about this app (see the assistant setup window). */
  assistant?: {
    /** Name the MCP server is registered under in an agent. Defaults to the app id. */
    serverName?: string;
    /** A paragraph about this app for the agent: what it is for, what to be careful with. */
    brief?: string;
  };
  /** Custom elements: what people may build for themselves inside the app. */
  custom?: {
    /** Elements that passed review and ship with the app. They run in the same sandbox. */
    elements?: CustomElement[];
    /** Functions the app offers to elements through `werkbank.call(name, args)`. Keep them read-only. */
    hostFunctions?: Record<string, { description: string; run: (args: unknown, wb: Werkbank) => unknown }>;
    /**
     * Libraries an element may load with `<script src="lib:NAME"></script>`. Elements have no network
     * access, so the app supplies the code; `@werkbank/chart-libraries` is a ready-made set.
     */
    libraries?: Record<string, { title: string; global: string; description: string; load: () => Promise<string> }>;
    /** Deliver a submission to wherever reviews happen (a tracker, a pull request). Without it, the package is downloaded. */
    submit?: (submission: ElementSubmission) => Promise<{ url?: string } | void>;
  };
}

/** What the bridge reports about itself when the app connects. */
export interface AssistantInfo {
  version: string;
  mcp: { url: string; port: number; stdio: { command: string; args: string[] } };
  agents: { id: string; label: string; available: boolean }[];
  defaultAgent: string;
}

/** Version of the framework. Sub-apps can show it; migrations key off it. */
export const FRAMEWORK_VERSION = "0.6.1";

const FRAMEWORK_SETTINGS: SettingSpec<any>[] = [
  {
    key: "assistant.connect", title: "Connect to the agent bridge", section: "Assistant", schema: z.boolean(), default: true,
    description: "Lets the in-app assistant and external agents read and drive this app through the local bridge.",
  },
  {
    key: "assistant.agent", title: "Agent for the in-app assistant", section: "Assistant", schema: z.string().max(40), default: "",
    description: "Which installed coding agent answers in the Assistant panel. Empty uses the bridge's default.",
  },
];

export interface LogEntry {
  seq: number;
  time: number;
  actor: Actor;
  commandId: string;
  title: string;
  input: unknown;
  ok: boolean;
  error?: string;
  /** Document before the command ran; present when the action can be undone. */
  before?: WorkspaceDoc;
  /** Panels whose state the command itself changed. */
  touched?: string[];
  /** Reverses the command's effect on the app's own data, if it had one. */
  revert?: () => void;
  undone?: boolean;
}

export interface Meta {
  log: LogEntry[];
  notes: string[];
  source: LoadSource;
  saved: boolean;
  bridge: "off" | "connecting" | "connected";
  pendingApproval: { commandId: string; title: string; input: unknown } | null;
  /** What the bridge said about itself and the agents installed, once connected. */
  assistant: AssistantInfo | null;
  /** Which app-level dialog is open, if any. */
  dialog: "settings" | "assistant" | null;
  /** Where the settings window opens: a section, and for Documentation a page. */
  dialogSection: { section: string; page?: string } | null;
  /** Increases when the set of tools changes (custom elements come and go). */
  toolsVersion: number;
}

type Listener = () => void;

export class Werkbank {
  readonly tools = new Map<string, ToolSpec<any>>();
  readonly commands = new CommandRegistry<Werkbank>();
  readonly storage: WorkspaceStorage;
  readonly themes: string[];
  readonly settings: SettingsStore;
  readonly custom: CustomElementStore;

  private doc: WorkspaceDoc;
  private meta: Meta;
  private docListeners = new Set<Listener>();
  private metaListeners = new Set<Listener>();
  private engine: LayoutEngine;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private approval: ((ok: boolean) => void) | null = null;
  private issued = new Set<string>();

  constructor(readonly config: WerkbankConfig) {
    for (const tool of config.tools) {
      if (this.tools.has(tool.id)) throw new Error(`Duplicate tool id: ${tool.id}`);
      this.tools.set(tool.id, tool);
    }
    this.themes = config.themes ?? ["xp", "dark", "light"];
    const store = config.storage ?? memoryStore();
    this.storage = new WorkspaceStorage(store, config.appId);
    const brand: SettingSpec<any>[] = config.logo
      ? [{ key: "appearance.logo", title: "Show the logo", section: "Appearance", schema: z.boolean(), default: true, description: `Shows the ${config.title} logo at the top of the rail.` }]
      : [];
    this.settings = new SettingsStore([...brand, ...FRAMEWORK_SETTINGS, ...(config.settings ?? [])], store, config.appId);
    this.custom = new CustomElementStore(store, config.appId);
    // Custom elements are tools too, so panels showing them survive a reload like any other.
    const topics = Object.keys(config.topics ?? {});
    for (const element of config.custom?.elements ?? []) this.tools.set(`e-${element.id}`, elementTool(element, false, topics));
    for (const element of this.custom.list()) this.tools.set(`c-${element.id}`, elementTool(element, true, topics));
    this.custom.subscribe(() => this.syncCustomTools());
    registerBuiltins(this);
    for (const tool of config.tools) tool.commands?.forEach((c) => this.commands.register(c));
    config.commands?.forEach((c) => this.commands.register(c));

    const loaded = this.loadInitial();
    this.doc = loaded.doc;
    for (const id in this.doc.instances) this.issued.add(id);
    this.meta = { log: [], notes: loaded.notes, source: loaded.source, saved: true, bridge: "off", pendingApproval: null, assistant: null, dialog: null, dialogSection: null, toolsVersion: 0 };
    this.engine = new MemoryEngine(this.doc.layout);
  }

  // ---- custom elements ----------------------------------------------------

  /** Keep the tool list in step with the person's custom elements. */
  private syncCustomTools(): void {
    const wanted = new Map(this.custom.list().map((e) => [`c-${e.id}`, e]));
    for (const [id, tool] of this.tools) {
      if (!tool.personal || wanted.has(id)) continue;
      // The element is gone: close the panels that showed it.
      for (const inst of Object.values(this.doc.instances)) if (inst.toolId === id) this.close(inst.id);
      this.tools.delete(id);
    }
    for (const [id, element] of wanted) {
      this.tools.set(id, elementTool(element, true, Object.keys(this.config.topics ?? {})));
      for (const inst of Object.values(this.doc.instances)) if (inst.toolId === id) this.engine.retitle(inst.id, this.titleOf(inst.id));
    }
    this.setMeta({ toolsVersion: this.meta.toolsVersion + 1 });
  }

  /** The element a tool id stands for, whether personal or shipped with the app. */
  elementOf(toolId: string): CustomElement | undefined {
    const id = this.tools.get(toolId)?.element;
    if (!id) return undefined;
    return toolId.startsWith("c-") ? this.custom.get(id) : this.config.custom?.elements?.find((e) => e.id === id);
  }

  /** The package a reviewer receives for an element. */
  submissionFor(id: string, notes = ""): ElementSubmission {
    const element = this.custom.get(id);
    if (!element) throw new Error(`No custom element called "${id}".`);
    return {
      kind: "werkbank-element-submission",
      app: `${this.config.appId}${this.config.version ? `@${this.config.version}` : ""}`,
      frameworkVersion: FRAMEWORK_VERSION,
      submitted: new Date().toISOString(),
      element,
      uses: scanElement(element.source),
      notes,
    };
  }

  // ---- state access -------------------------------------------------------

  getDoc = (): WorkspaceDoc => this.doc;
  getMeta = (): Meta => this.meta;
  subscribeDoc = (fn: Listener) => (this.docListeners.add(fn), () => void this.docListeners.delete(fn));
  subscribeMeta = (fn: Listener) => (this.metaListeners.add(fn), () => void this.metaListeners.delete(fn));

  private setDoc(next: WorkspaceDoc, save = true): void {
    if (next === this.doc) return;
    this.doc = next;
    for (const id in next.instances) this.issued.add(id);
    this.docListeners.forEach((fn) => fn());
    if (save) this.scheduleSave();
  }

  setMeta(patch: Partial<Meta>): void {
    this.meta = { ...this.meta, ...patch };
    this.metaListeners.forEach((fn) => fn());
  }

  // ---- layout engine ------------------------------------------------------

  /** Called by the layout module when the real engine mounts or unmounts. */
  attachEngine(engine: LayoutEngine | null): void {
    this.engine = engine ?? new MemoryEngine(this.doc.layout);
  }

  getEngine = (): LayoutEngine => this.engine;

  /** Pull the engine's layout into the document. Called after every change. */
  syncLayout(): void {
    const { layout, detached } = this.engine.snapshot();
    const merged = mergeTabs(layout, detached);
    if (JSON.stringify(merged) !== JSON.stringify(this.doc.layout)) this.setDoc({ ...this.doc, layout: merged });
  }

  activeInstanceId(): string | undefined {
    const { layout } = this.engine.snapshot();
    const active = this.engine.activeTabsetId();
    const set = tabsets(layout).find((t) => t.id === active) ?? tabsets(layout).find((t) => t.tabs.length > 0);
    return set?.selectedId ?? set?.tabs[0]?.id;
  }

  /**
   * The open panel of a tool that a click on the tool should go to, if there is one. With several open,
   * repeated calls walk through them: the one after the active panel comes next. Docked panels come before
   * those in windows of their own.
   */
  openPanelOf(toolId: string): string | undefined {
    const { layout, detached } = this.engine.snapshot();
    const ofTool = (ids: string[]) => ids.filter((id) => this.doc.instances[id]?.toolId === toolId);
    const open = [...ofTool(tabsets(layout).flatMap((set) => set.tabs.map((tab) => tab.id))), ...ofTool(detached.map((tab) => tab.id))];
    if (!open.length) return undefined;
    return open[(open.indexOf(this.activeInstanceId() ?? "") + 1) % open.length];
  }

  // ---- panels -------------------------------------------------------------

  titleOf(id: string): string {
    const inst = this.doc.instances[id];
    return inst?.title ?? this.tools.get(inst?.toolId ?? "")?.title ?? id;
  }

  open(toolId: string, options: { state?: unknown; link?: string | null; target?: DropTarget; title?: string } = {}): string {
    const tool = this.tools.get(toolId);
    if (!tool) throw new Error(`Unknown tool: ${toolId}`);
    if (Object.keys(this.doc.instances).length >= LIMITS.instances) {
      throw new Error(`Panel limit reached (${LIMITS.instances}).`);
    }
    const state = tool.stateSchema.parse(options.state ?? tool.defaultState());
    // Ids are never reused in a session, so undo cannot confuse two panels.
    let n = 1;
    while (this.issued.has(`${toolId}-${n}`)) n++;
    const id = `${toolId}-${n}`;
    this.issued.add(id);
    const instance: Instance = {
      id,
      toolId,
      version: tool.version,
      state,
      link: options.link ?? null,
      local: {},
      ...(options.title ? { title: options.title } : {}),
    };
    this.setDoc({ ...this.doc, instances: { ...this.doc.instances, [id]: instance } });
    if (!this.engine.addTab({ id, title: this.titleOf(id) }, options.target)) {
      this.dropInstances([id]);
      throw new Error("The layout refused the new panel.");
    }
    this.syncLayout();
    return id;
  }

  close(id: string): void {
    if (!this.doc.instances[id]) throw new Error(`Unknown panel: ${id}`);
    this.engine.closeTab(id);
    this.dropInstances([id]);
    this.syncLayout();
  }

  private dropInstances(ids: string[]): void {
    const instances = { ...this.doc.instances };
    ids.forEach((id) => delete instances[id]);
    this.setDoc({ ...this.doc, instances });
  }

  duplicate(id: string): string {
    const inst = this.requireInstance(id);
    const set = tabsetOf(this.engine.snapshot().layout, id);
    const copy = this.open(inst.toolId, {
      state: structuredClone(inst.state),
      link: inst.link,
      ...(set ? { target: { tabsetId: set.id, region: "center" as const } } : {}),
    });
    this.patchInstance(copy, { local: structuredClone(inst.local) });
    return copy;
  }

  requireInstance(id: string): Instance {
    const inst = this.doc.instances[id];
    if (!inst) throw new Error(`Unknown panel: ${id}`);
    return inst;
  }

  private patchInstance(id: string, patch: Partial<Instance>): void {
    const inst = this.requireInstance(id);
    this.setDoc({ ...this.doc, instances: { ...this.doc.instances, [id]: { ...inst, ...patch } } });
  }

  /** Replace a panel's private state. The tool's schema is the gatekeeper. */
  setState(id: string, state: unknown): void {
    const inst = this.doc.instances[id];
    if (!inst) return; // late update from a panel that was just closed
    const tool = this.tools.get(inst.toolId)!;
    this.patchInstance(id, { state: tool.stateSchema.parse(state) });
  }

  // ---- linking ------------------------------------------------------------

  /** Topic values a panel currently sees. */
  linksOf(id: string): Record<string, unknown> {
    const inst = this.doc.instances[id];
    if (!inst) return {};
    return inst.link ? (this.doc.links[inst.link] ?? {}) : inst.local;
  }

  private checkTopic(topic: string, value: unknown): unknown {
    const schema = this.config.topics?.[topic];
    return schema ? schema.parse(value) : value;
  }

  /** Publish from a panel: to its group when linked, else to itself only. */
  publish(id: string, topic: string, value: unknown): void {
    const inst = this.requireInstance(id);
    const checked = this.checkTopic(topic, value);
    if (inst.link) this.publishToGroup(inst.link, topic, checked);
    else this.patchInstance(id, { local: { ...inst.local, [topic]: checked } });
  }

  publishToGroup(group: string, topic: string, value: unknown): void {
    if (!LINK_GROUPS.includes(group as (typeof LINK_GROUPS)[number])) throw new Error(`Unknown link group: ${group}`);
    const checked = this.checkTopic(topic, value);
    const current = this.doc.links[group] ?? {};
    if (JSON.stringify(current[topic]) === JSON.stringify(checked)) return;
    this.setDoc({ ...this.doc, links: { ...this.doc.links, [group]: { ...current, [topic]: checked } } });
  }

  /**
   * Join a group or leave it. Leaving keeps the values the panel was showing;
   * joining an empty group seeds it with them, so nothing blanks on screen.
   */
  setLink(id: string, group: string | null): void {
    const inst = this.requireInstance(id);
    if (inst.link === group) return;
    if (group !== null && !LINK_GROUPS.includes(group as (typeof LINK_GROUPS)[number])) {
      throw new Error(`Unknown link group: ${group}`);
    }
    const showing = this.linksOf(id);
    let links = this.doc.links;
    if (group !== null) links = { ...links, [group]: { ...showing, ...(links[group] ?? {}) } };
    this.setDoc({
      ...this.doc,
      links,
      instances: { ...this.doc.instances, [id]: { ...inst, link: group, local: group === null ? { ...showing } : inst.local } },
    });
  }

  // ---- shell --------------------------------------------------------------

  setShell(patch: Partial<WorkspaceDoc["shell"]>): void {
    this.setDoc({ ...this.doc, shell: { ...this.doc.shell, ...patch } });
  }

  // ---- commands, log, undo ------------------------------------------------

  async run(commandId: string, input?: unknown, actor: Actor = "user"): Promise<CommandResult> {
    const command = this.commands.get(commandId);
    if (!command) return { ok: false, code: "unknown", error: `Unknown command: ${commandId}` };
    if (command.when && !command.when(this)) {
      return { ok: false, code: "unavailable", error: `Command is not available now: ${commandId}` };
    }
    let parsed: unknown = input;
    if (command.input) {
      const result = command.input.safeParse(input ?? {});
      if (!result.success) return { ok: false, code: "invalid", error: result.error.message };
      parsed = result.data;
    }
    if (needsApproval(command.risk, actor) && !(await this.requestApproval(command, parsed))) {
      this.record(command, parsed, actor, undefined, "Denied by the user.");
      return { ok: false, code: "denied", error: "The user did not approve this action." };
    }
    const before = this.doc;
    try {
      const value = await command.run({ wb: this, actor }, parsed);
      const revert = command.undo ? () => command.undo!({ wb: this, actor }, parsed, value) : undefined;
      this.record(command, parsed, actor, before, undefined, revert);
      return { ok: true, value: value ?? null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.record(command, parsed, actor, undefined, message);
      return { ok: false, code: "failed", error: message };
    }
  }

  private record(
    command: Command<Werkbank, any>,
    input: unknown,
    actor: Actor,
    before?: WorkspaceDoc,
    error?: string,
    revert?: () => void,
  ): void {
    if (command.risk === "read" || command.log === false) return;
    const undoable = command.risk === "local" && before !== undefined && (before !== this.doc || revert !== undefined);
    const touched = undoable
      ? Object.keys(this.doc.instances).filter((id) => before.instances[id] && before.instances[id].state !== this.doc.instances[id]!.state)
      : undefined;
    const entry: LogEntry = {
      seq: ++this.seq,
      time: Date.now(),
      actor,
      commandId: command.id,
      title: command.title,
      input,
      ok: error === undefined,
      ...(error !== undefined ? { error } : {}),
      ...(undoable ? { before, touched, ...(revert ? { revert } : {}) } : {}),
    };
    this.setMeta({ log: [...this.meta.log, entry].slice(-200) });
  }

  private requestApproval(command: Command<Werkbank, any>, input: unknown): Promise<boolean> {
    if (this.approval) return Promise.resolve(false); // one request at a time
    return new Promise<boolean>((resolve) => {
      this.approval = resolve;
      this.setMeta({ pendingApproval: { commandId: command.id, title: command.title, input } });
    });
  }

  /** Called by the shell's approval dialog. */
  resolveApproval(ok: boolean): void {
    const resolve = this.approval;
    this.approval = null;
    this.setMeta({ pendingApproval: null });
    resolve?.(ok);
  }

  /**
   * Undo the most recent undoable action. Layout, links and the set of open
   * panels go back to how they were. A panel that exists both before and now
   * keeps its current state, unless the undone action itself changed it, so
   * undoing a layout change never discards what was typed since.
   */
  undo(): LogEntry | null {
    const entry = [...this.meta.log].reverse().find((e) => e.before && !e.undone);
    if (!entry?.before) return null;
    const before = entry.before;
    entry.revert?.();
    const instances: Record<string, Instance> = {};
    for (const [id, old] of Object.entries(before.instances)) {
      const now = this.doc.instances[id];
      instances[id] = now && !entry.touched?.includes(id) ? { ...old, state: now.state } : old;
    }
    this.apply({ ...before, instances, shell: this.doc.shell });
    this.setMeta({ log: this.meta.log.map((e) => (e.seq === entry.seq ? { ...e, undone: true } : e)) });
    return entry;
  }

  // ---- whole-document operations ------------------------------------------

  /** Carry session state (see `keepAcrossWorkspaces`) from the current workspace into the one replacing it. */
  private carryOver(next: WorkspaceDoc): WorkspaceDoc {
    const kept = new Map<string, unknown>();
    for (const inst of Object.values(this.doc.instances)) {
      if (this.tools.get(inst.toolId)?.keepAcrossWorkspaces && !kept.has(inst.toolId)) kept.set(inst.toolId, inst.state);
    }
    if (kept.size === 0) return next;
    const instances = { ...next.instances };
    for (const [id, inst] of Object.entries(instances)) {
      if (kept.has(inst.toolId)) {
        instances[id] = { ...inst, state: kept.get(inst.toolId) };
        kept.delete(inst.toolId); // one panel inherits it
      }
    }
    return { ...next, instances };
  }

  /** Replace the document and push its layout into the engine. */
  private apply(doc: WorkspaceDoc): void {
    this.setDoc(doc);
    this.engine.setLayout(doc.layout);
    this.syncLayout();
  }

  /** Load an untrusted document (named workspace, import). Throws if unusable. */
  loadDoc(raw: unknown): string[] {
    const result = normaliseDoc(raw, this.tools, this.config.appId);
    if (!result) throw new Error("This is not a valid workspace document.");
    // Theme, density and the side dock are the user's settings, not the workspace's.
    this.apply(this.carryOver({ ...result.doc, shell: this.doc.shell }));
    return result.notes;
  }

  reset(): void {
    this.apply(this.carryOver({ ...this.defaultDoc(), shell: this.doc.shell }));
  }

  /** Switch to one of the app's ready-made workspaces. */
  loadPreset(name: string): void {
    const seed = this.config.presets?.[name];
    if (!seed) throw new Error(`Unknown preset: ${name}`);
    this.apply(this.carryOver({ ...this.defaultDoc({ ...seed, name }), shell: this.doc.shell }));
  }

  private defaultDoc(seed: WorkspaceSeed = this.config.defaultWorkspace): WorkspaceDoc {
    const theme = this.themes[0] ?? "xp";
    const raw = docFromSeed(seed, this.config.appId, theme);
    return normaliseDoc(raw, this.tools, this.config.appId)?.doc ?? emptyDoc(this.config.appId, theme);
  }

  private loadInitial(): { doc: WorkspaceDoc; notes: string[]; source: LoadSource } {
    const notes: string[] = [];
    for (const candidate of this.storage.candidates()) {
      const result = normaliseDoc(candidate.raw, this.tools, this.config.appId);
      if (result) {
        if (candidate.source === "last-good") notes.unshift("The saved workspace was unreadable; restored the last good copy.");
        return { doc: result.doc, notes: [...notes, ...result.notes], source: candidate.source };
      }
      if (candidate.source === "saved") this.storage.quarantine();
    }
    if (this.storage.candidates().length > 0) notes.push("No saved workspace could be read; started from the default.");
    return { doc: this.defaultDoc(), notes, source: "default" };
  }

  // ---- persistence --------------------------------------------------------

  private scheduleSave(): void {
    if (this.meta.saved) this.setMeta({ saved: false });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const ok = this.storage.saveCurrent(this.doc);
    this.setMeta({ saved: ok, ...(ok ? {} : { notes: ["Saving failed; the workspace is only in memory."] }) });
  }

  // ---- agent view ---------------------------------------------------------

  /**
   * A structured snapshot of the running app, for agents and tests.
   *
   * `detail: "summary"` lists the panels without their state and data, which is
   * enough to find one's way around and costs little to read. `panels` limits
   * the snapshot to the given panel ids. The default is everything.
   */
  describe(options: DescribeOptions = {}): unknown {
    const { layout, detached } = this.engine.snapshot();
    const visible = new Set(tabsets(layout).map((t) => t.selectedId ?? t.tabs[0]?.id));
    const poppedOut = new Set(detached.map((t) => t.id));
    const full = options.detail !== "summary";
    const wanted = options.panels ? new Set(options.panels) : null;
    const unknown = options.panels?.filter((id) => !this.doc.instances[id]) ?? [];
    return {
      app: this.config.title,
      workspace: this.doc.name,
      theme: this.doc.shell.theme,
      activePanel: this.activeInstanceId() ?? null,
      layout: outline(layout, (id) => this.titleOf(id)),
      panels: Object.values(this.doc.instances)
        .filter((inst) => !wanted || wanted.has(inst.id))
        .map((inst) => {
          const tool = this.tools.get(inst.toolId)!;
          const links = this.linksOf(inst.id);
          return {
            id: inst.id,
            tool: inst.toolId,
            title: this.titleOf(inst.id),
            linkGroup: inst.link,
            links,
            visible: visible.has(inst.id) || poppedOut.has(inst.id),
            poppedOut: poppedOut.has(inst.id),
            ...(full ? { state: inst.state, data: tool.describe ? tool.describe(inst.state, { instance: inst, links }) : undefined } : {}),
          };
        }),
      ...(unknown.length ? { unknownPanels: unknown } : {}),
      linkGroups: this.doc.links,
      tools: [...this.tools.values()].map((t) => ({ id: t.id, title: t.title, category: t.category ?? null, links: t.links ?? [] })),
      savedWorkspaces: this.storage.names(),
      presets: Object.keys(this.config.presets ?? {}),
      settings: this.settings.all(),
      customElements: this.custom.list().map((e) => ({ id: e.id, title: e.title, status: e.status, revision: e.revision })),
      ...(full ? {} : { note: "Summary only. Ask for specific panels with detail \"full\" to get their state and the data behind their view." }),
    };
  }

  /** The action history in a form that can be sent elsewhere. */
  history(): unknown {
    return this.meta.log.map(({ before, revert: _revert, ...entry }) => ({ ...entry, time: new Date(entry.time).toISOString(), undoable: Boolean(before) && !entry.undone }));
  }
}

export interface DescribeOptions {
  detail?: "summary" | "full";
  panels?: string[];
}

/**
 * A layout engine with no screen. It keeps the tree consistent so the core
 * can be tested, and stands in until the real engine mounts.
 */
export class MemoryEngine implements LayoutEngine {
  private active: string | undefined;
  private layout: Layout;
  constructor(layout: Layout) {
    this.layout = structuredClone(layout);
  }

  snapshot = () => ({ layout: this.layout, detached: [] as LayoutTab[] });
  setLayout(layout: Layout) {
    this.layout = structuredClone(layout);
  }
  addTab(tab: LayoutTab, target?: DropTarget): boolean {
    if (tabIds(this.layout).includes(tab.id)) return false;
    const sets = tabsets(this.layout);
    const wanted = target && "tabsetId" in target ? target.tabsetId : this.active;
    const set = sets.find((s) => s.id === wanted) ?? sets[0]!;
    set.tabs = [...set.tabs, tab];
    set.selectedId = tab.id;
    this.layout = structuredClone(this.layout);
    this.active = set.id;
    return true;
  }
  closeTab(id: string) {
    this.layout = filterTabs(this.layout, (t) => t.id !== id);
  }
  selectTab(id: string) {
    const set = tabsetOf(this.layout, id);
    if (!set) return;
    set.selectedId = id;
    this.active = set.id;
    this.layout = structuredClone(this.layout);
  }
  moveTab(id: string, target: DropTarget) {
    const set = tabsetOf(this.layout, id);
    const tab = set?.tabs.find((t) => t.id === id);
    if (!tab || !("tabsetId" in target)) return;
    this.closeTab(id);
    this.addTab(tab, target);
  }
  retitle(id: string, title: string) {
    const tab = tabsetOf(this.layout, id)?.tabs.find((t) => t.id === id);
    if (tab) tab.title = title;
    this.layout = structuredClone(this.layout);
  }
  toggleMaximize(tabsetId: string) {
    const { maximizedTabsetId: current, ...rest } = this.layout;
    this.layout = current === tabsetId ? rest : { ...rest, maximizedTabsetId: tabsetId };
  }
  floatTab() {}
  popout() {
    return false;
  }
  activeTabsetId = () => this.active;
  neighbour() {
    return undefined;
  }
  focusTabset(tabsetId: string) {
    this.active = tabsetId;
  }
}

/** A custom element as a tool. Its state is whatever JSON the element saves. */
function elementTool(element: CustomElement, personal: boolean, topics: string[]): ToolSpec<Record<string, unknown>> {
  return {
    id: `${personal ? "c" : "e"}-${element.id}`,
    // "(C)" marks an element the person built themselves, as opposed to one that ships with the app.
    title: personal ? `${element.title} (C)` : element.title,
    glyph: personal ? "✧" : "◇",
    category: personal ? "Custom" : "Elements",
    version: 1,
    element: element.id,
    personal,
    // An element may follow any shared context, so its tab offers the link groups.
    links: topics,
    stateSchema: z.object({ saved: z.unknown() }).catchall(z.unknown()) as unknown as z.ZodType<Record<string, unknown>>,
    defaultState: () => ({ saved: null }),
    describe: (state) => ({
      customElement: element.id,
      personal,
      status: element.status,
      description: element.description,
      savedState: state.saved ?? null,
      note: personal ? "A custom element built by the user. It runs in a sandbox and is not part of the shared app." : "An element that passed review and ships with the app.",
    }),
  };
}
