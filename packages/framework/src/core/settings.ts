import type { z } from "zod";
import type { KeyValueStore } from "./storage";

/**
 * App settings: values that belong to the person and the app, not to one
 * workspace. The framework defines a few; an app adds its own by listing
 * `SettingSpec`s in its config, and they appear in the settings dialog with a
 * control chosen from the spec. Every value is validated by its schema.
 */
export interface SettingSpec<T = unknown> {
  /** Dotted and unique, e.g. "trading.defaultQuantity". */
  key: string;
  title: string;
  /** Heading the setting is listed under. */
  section: string;
  description?: string;
  schema: z.ZodType<T>;
  default: T;
  /** How to edit it. Inferred from the default's type when omitted. */
  control?: "switch" | "select" | "text" | "number" | "textarea";
  /** Choices for a select. */
  options?: { value: string; label: string }[];
  /** Suggestions for a text control; any value the schema accepts may still be typed. */
  suggestions?: string[];
}

type Listener = () => void;

export class SettingsStore {
  private specs = new Map<string, SettingSpec<any>>();
  private values: Record<string, unknown> = {};
  private listeners = new Set<Listener>();
  private key: string;

  constructor(
    specs: SettingSpec<any>[],
    private store: KeyValueStore,
    appId: string,
  ) {
    this.key = `${appId}.settings`;
    for (const spec of specs) {
      if (this.specs.has(spec.key)) throw new Error(`Duplicate setting: ${spec.key}`);
      this.specs.set(spec.key, spec);
    }
    let saved: Record<string, unknown> = {};
    try {
      const raw = JSON.parse(this.store.getItem(this.key) ?? "{}");
      if (raw && typeof raw === "object") saved = raw;
    } catch {
      /* unreadable settings fall back to defaults */
    }
    // A stored value that no longer passes its schema (the app changed) falls back to the default.
    for (const spec of specs) {
      const parsed = spec.key in saved ? spec.schema.safeParse(saved[spec.key]) : null;
      this.values[spec.key] = parsed?.success ? parsed.data : spec.default;
    }
  }

  list = (): SettingSpec<any>[] => [...this.specs.values()];
  sections = (): string[] => [...new Set(this.list().map((s) => s.section))];
  all = (): Record<string, unknown> => this.values;
  subscribe = (fn: Listener) => (this.listeners.add(fn), () => void this.listeners.delete(fn));

  get<T = unknown>(key: string): T {
    if (!this.specs.has(key)) throw new Error(`Unknown setting: ${key}`);
    return this.values[key] as T;
  }

  /** Set a value. Returns the previous one, so the change can be undone. */
  set(key: string, value: unknown): unknown {
    const spec = this.specs.get(key);
    if (!spec) throw new Error(`Unknown setting: ${key}`);
    const parsed = spec.schema.parse(value);
    const previous = this.values[key];
    if (JSON.stringify(previous) === JSON.stringify(parsed)) return previous;
    this.values = { ...this.values, [key]: parsed };
    try {
      this.store.setItem(this.key, JSON.stringify(this.values));
    } catch {
      /* the value then lasts for this page load only */
    }
    this.listeners.forEach((fn) => fn());
    return previous;
  }

  reset(key: string): unknown {
    return this.set(key, this.specs.get(key)?.default);
  }
}
