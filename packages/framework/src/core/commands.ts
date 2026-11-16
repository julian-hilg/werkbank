import { z } from "zod";

/**
 * One registry of typed commands. The palette, keybindings and the agent
 * bridge all read this list, so a person and an agent can do the same things.
 */

/**
 * read: no change. local: changes this workspace and can be undone.
 * external: has an effect outside the app. irreversible: cannot be undone.
 * Agents need a person's approval for the last two.
 */
export type Risk = "read" | "local" | "external" | "irreversible";
export type Actor = "user" | "agent";

export interface CommandContext<W> {
  wb: W;
  actor: Actor;
}

export interface Command<W, I = unknown> {
  id: string;
  title: string;
  category?: string;
  /** Default keybinding, for example "mod+k" or "ctrl+shift+ArrowLeft". */
  keys?: string;
  risk: Risk;
  /** Input schema. Omit for commands without input. */
  input?: z.ZodType<I>;
  /** Set false to keep view-only actions (theme, zoom) out of the action log. */
  log?: boolean;
  /** Set false to hide the command from the palette; it still runs. */
  palette?: boolean;
  /** Hide and refuse the command when this returns false. */
  when?: (wb: W) => boolean;
  /** Palette entries with the input already chosen, e.g. one per tool. */
  expand?: (wb: W) => { title: string; input: NoInfer<I> }[];
  run: (ctx: CommandContext<W>, input: I) => unknown;
  /**
   * Reverses the command's effect on data that lives outside the workspace
   * document (the app's own stores). Receives what `run` returned. Changes to
   * the workspace itself are undone automatically and need nothing here.
   */
  undo?: (ctx: CommandContext<W>, input: I, result: unknown) => void;
}

export type CommandResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; code: "unknown" | "invalid" | "unavailable" | "denied" | "failed" };

export interface PaletteEntry {
  key: string;
  commandId: string;
  title: string;
  category: string;
  keys?: string;
  input: unknown;
}

export const needsApproval = (risk: Risk, actor: Actor) =>
  actor === "agent" && (risk === "external" || risk === "irreversible");

export class CommandRegistry<W> {
  private commands = new Map<string, Command<W, any>>();

  register<I>(command: Command<W, I>): void {
    if (this.commands.has(command.id)) throw new Error(`Duplicate command id: ${command.id}`);
    this.commands.set(command.id, command);
  }

  get(id: string): Command<W, any> | undefined {
    return this.commands.get(id);
  }

  list(): Command<W, any>[] {
    return [...this.commands.values()];
  }

  /** Flat list for the palette: expanded entries plus input-free commands. */
  palette(wb: W): PaletteEntry[] {
    const out: PaletteEntry[] = [];
    for (const c of this.commands.values()) {
      if (c.palette === false || (c.when && !c.when(wb))) continue;
      const category = c.category ?? "General";
      if (c.expand) {
        c.expand(wb).forEach((e, i) =>
          out.push({ key: `${c.id}#${i}`, commandId: c.id, title: e.title, category, input: e.input }),
        );
      } else if (!c.input || c.input.safeParse({}).success) {
        // Commands that require input are reachable by agents and code only.
        out.push({
          key: c.id,
          commandId: c.id,
          title: c.title,
          category,
          ...(c.keys ? { keys: c.keys } : {}),
          input: c.input ? {} : undefined,
        });
      }
    }
    return out;
  }

  /**
   * Machine-readable catalogue for agents. Without arguments it is a compact
   * index; `ids` returns those commands with the JSON schema of their input;
   * `query` filters by words in the id, title or category.
   */
  describe(wb: W, options: { ids?: string[]; query?: string; schemas?: boolean } = {}): CommandInfo[] {
    const words = options.query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    const withSchemas = options.schemas ?? Boolean(options.ids);
    return this.list()
      .filter((c) => !options.ids || options.ids.includes(c.id))
      .filter((c) => words.every((w) => `${c.id} ${c.title} ${c.category ?? ""}`.toLowerCase().includes(w)))
      .map((c) => ({
        id: c.id,
        title: c.title,
        category: c.category ?? "General",
        risk: c.risk,
        available: !c.when || c.when(wb),
        undoable: c.risk === "local" && c.log !== false,
        takesInput: Boolean(c.input),
        ...(withSchemas ? { input: c.input ? z.toJSONSchema(c.input, { unrepresentable: "any" }) : null } : {}),
      }));
  }
}

export interface CommandInfo {
  id: string;
  title: string;
  category: string;
  risk: Risk;
  available: boolean;
  /** True if the action history can reverse it. */
  undoable: boolean;
  takesInput: boolean;
  /** JSON schema of the input; present when schemas were asked for. */
  input?: unknown;
}

/** Normalise a keyboard event to the same form as `Command.keys`. */
export function eventKeys(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): string[] {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const base = `${e.altKey ? "alt+" : ""}${e.shiftKey ? "shift+" : ""}${key}`;
  const out: string[] = [];
  if (e.ctrlKey && !e.metaKey) out.push(`ctrl+${base}`, `mod+${base}`);
  else if (e.metaKey && !e.ctrlKey) out.push(`meta+${base}`, `mod+${base}`);
  else if (!e.ctrlKey && !e.metaKey) out.push(base);
  return out;
}

export const normaliseKeys = (keys: string) => {
  const parts = keys.split("+");
  const key = parts.pop()!;
  const mods = parts.map((p) => p.toLowerCase());
  const lead = mods.find((m) => m === "ctrl" || m === "meta" || m === "mod");
  return `${lead ? lead + "+" : ""}${mods.includes("alt") ? "alt+" : ""}${mods.includes("shift") ? "shift+" : ""}${key.length === 1 ? key.toLowerCase() : key}`;
};
