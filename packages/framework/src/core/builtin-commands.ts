import { z } from "zod";
import { documentation } from "./guide";
import { LINK_GROUPS } from "./document";
import { tabsetOf } from "./layout-model";
import type { Direction, DropTarget, Werkbank } from "./werkbank";

const panelId = z.object({ id: z.string().optional() });
const directions: Direction[] = ["left", "right", "up", "down"];
const arrow = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" } as const;
const region = { left: "left", right: "right", up: "top", down: "bottom" } as const;

const dropTarget: z.ZodType<DropTarget> = z.union([
  z.object({ tabsetId: z.string(), index: z.number().int().min(0) }),
  z.object({ tabsetId: z.string(), region: z.enum(["left", "right", "top", "bottom", "center"]) }),
  z.object({ edge: z.enum(["left", "right", "top", "bottom"]) }),
]);

const target = (wb: Werkbank, id?: string): string => {
  const resolved = id ?? wb.activeInstanceId();
  if (!resolved) throw new Error("There is no active panel.");
  wb.requireInstance(resolved);
  return resolved;
};

const tabsetFor = (wb: Werkbank, id: string): string => {
  const set = tabsetOf(wb.getEngine().snapshot().layout, id);
  if (!set) throw new Error(`Panel ${id} is not in the main window.`);
  return set.id;
};

/** Commands every app built on Werkbank has. */
export function registerBuiltins(wb: Werkbank): void {
  const c = wb.commands;

  c.register({
    id: "workspace.describe",
    title: "Describe workspace",
    category: "Workspace",
    risk: "read",
    input: z.object({}),
    palette: false, // for agents and code
    run: ({ wb }) => wb.describe(),
  });

  c.register({
    id: "panel.open",
    title: "Open panel",
    category: "Panel",
    risk: "local",
    input: z.object({
      toolId: z.string(),
      state: z.unknown().optional(),
      link: z.enum(LINK_GROUPS).nullable().optional(),
      target: dropTarget.optional(),
    }),
    expand: (wb) => [...wb.tools.values()].map((t) => ({ title: `Open ${t.title}`, input: { toolId: t.id } })),
    run: ({ wb }, i) =>
      wb.open(i.toolId, {
        ...(i.state !== undefined ? { state: i.state } : {}),
        ...(i.link !== undefined ? { link: i.link } : {}),
        ...(i.target ? { target: i.target } : {}),
      }),
  });

  c.register({
    id: "panel.close",
    title: "Close panel",
    category: "Panel",
    risk: "local",
    input: panelId,
    run: ({ wb }, i) => wb.close(target(wb, i.id)),
  });

  c.register({
    id: "panel.closeOthers",
    title: "Close all other panels",
    category: "Panel",
    risk: "local",
    input: panelId,
    run: ({ wb }, i) => {
      const keep = target(wb, i.id);
      for (const id of Object.keys(wb.getDoc().instances)) if (id !== keep) wb.close(id);
    },
  });

  c.register({
    id: "panel.duplicate",
    title: "Duplicate panel",
    category: "Panel",
    risk: "local",
    input: panelId,
    run: ({ wb }, i) => wb.duplicate(target(wb, i.id)),
  });

  c.register({
    id: "panel.focus",
    title: "Focus panel",
    category: "Panel",
    risk: "local",
    log: false,
    input: z.object({ id: z.string() }),
    expand: (wb) => Object.keys(wb.getDoc().instances).map((id) => ({ title: `Go to ${wb.titleOf(id)} (${id})`, input: { id } })),
    run: ({ wb }, i) => {
      wb.requireInstance(i.id);
      wb.getEngine().selectTab(i.id);
      wb.syncLayout();
    },
  });

  c.register({
    id: "panel.setState",
    title: "Set panel state",
    category: "Panel",
    risk: "local",
    input: z.object({
      id: z.string(),
      /** Fields to change; merged over the current state, then validated. */
      patch: z.record(z.string(), z.unknown()),
    }),
    run: ({ wb }, i) => {
      const inst = wb.requireInstance(i.id);
      const base = inst.state && typeof inst.state === "object" ? inst.state : {};
      wb.setState(i.id, { ...base, ...i.patch });
    },
  });

  c.register({
    id: "panel.move",
    title: "Move panel",
    category: "Panel",
    risk: "local",
    input: z.object({ id: z.string().optional(), target: dropTarget }),
    run: ({ wb }, i) => {
      wb.getEngine().moveTab(target(wb, i.id), i.target);
      wb.syncLayout();
    },
  });

  c.register({
    id: "panel.link",
    title: "Link panel to group",
    category: "Link",
    risk: "local",
    input: z.object({ id: z.string().optional(), group: z.enum(LINK_GROUPS).nullable() }),
    expand: () => [
      ...LINK_GROUPS.map((g) => ({ title: `Link panel to group ${g}`, input: { group: g } })),
      { title: "Unlink panel", input: { group: null } },
    ],
    run: ({ wb }, i) => wb.setLink(target(wb, i.id), i.group),
  });

  c.register({
    id: "link.publish",
    title: "Publish value to link group",
    category: "Link",
    risk: "local",
    input: z.object({ group: z.enum(LINK_GROUPS), topic: z.string(), value: z.unknown() }),
    run: ({ wb }, i) => wb.publishToGroup(i.group, i.topic, i.value),
  });

  for (const d of directions) {
    c.register({
      id: `panel.focus.${d}`,
      title: `Focus panel ${d}`,
      category: "Navigate",
      risk: "local",
      log: false,
      keys: `ctrl+shift+${arrow[d]}`,
      run: ({ wb }) => {
        const engine = wb.getEngine();
        const from = engine.activeTabsetId();
        const to = from && engine.neighbour(from, d);
        if (to) engine.focusTabset(to);
      },
    });
    c.register({
      id: `panel.move.${d}`,
      title: `Move panel ${d}`,
      category: "Navigate",
      risk: "local",
      run: ({ wb }) => {
        const engine = wb.getEngine();
        const id = target(wb);
        const from = tabsetFor(wb, id);
        const to = engine.neighbour(from, d);
        // Into the neighbour if there is one, otherwise split off in that direction.
        engine.moveTab(id, to ? { tabsetId: to, region: "center" } : { tabsetId: from, region: region[d] });
        wb.syncLayout();
      },
    });
  }

  c.register({
    id: "panel.maximize",
    title: "Maximise or restore panel",
    category: "View",
    risk: "local",
    log: false,
    keys: "ctrl+shift+m",
    run: ({ wb }) => {
      wb.getEngine().toggleMaximize(tabsetFor(wb, target(wb)));
      wb.syncLayout();
    },
  });

  c.register({
    id: "panel.popout",
    title: "Move panel to its own window",
    category: "Panel",
    risk: "local",
    log: false,
    input: panelId,
    run: ({ wb }, i) => {
      if (!wb.getEngine().popout(target(wb, i.id))) throw new Error("The browser blocked the new window.");
      wb.syncLayout();
    },
  });

  c.register({
    id: "panel.float",
    title: "Float panel above the layout",
    category: "Panel",
    risk: "local",
    input: panelId,
    run: ({ wb }, i) => {
      wb.getEngine().floatTab(target(wb, i.id));
      wb.syncLayout();
    },
  });

  c.register({
    id: "view.zen",
    title: "Toggle zen mode (hide shell chrome)",
    category: "View",
    risk: "local",
    log: false,
    keys: "ctrl+shift+Enter",
    run: ({ wb }) => wb.setShell({ zen: !wb.getDoc().shell.zen }),
  });

  c.register({
    id: "view.side",
    title: "Show side view",
    category: "View",
    risk: "local",
    log: false,
    input: z.object({ view: z.string().nullable() }),
    run: ({ wb }, i) => wb.setShell({ sideView: i.view }),
  });

  c.register({
    id: "view.toggleSide",
    title: "Toggle side dock",
    category: "View",
    risk: "local",
    log: false,
    keys: "mod+b",
    run: ({ wb }) => wb.setShell({ sideView: wb.getDoc().shell.sideView ? null : "tools" }),
  });

  c.register({
    id: "view.theme",
    title: "Set theme",
    category: "View",
    risk: "local",
    log: false,
    input: z.object({ theme: z.string() }),
    expand: (wb) => wb.themes.map((theme) => ({ title: `Theme: ${theme}`, input: { theme } })),
    run: ({ wb }, i) => {
      if (!wb.themes.includes(i.theme)) throw new Error(`Unknown theme: ${i.theme}`);
      wb.setShell({ theme: i.theme });
    },
  });

  c.register({
    id: "view.density",
    title: "Toggle density (compact / comfortable)",
    category: "View",
    risk: "local",
    log: false,
    run: ({ wb }) => wb.setShell({ density: wb.getDoc().shell.density === "compact" ? "comfortable" : "compact" }),
  });

  c.register({
    id: "workspace.save",
    title: "Save workspace as",
    category: "Workspace",
    risk: "local",
    log: false,
    input: z.object({ name: z.string().trim().min(1).max(60) }),
    run: ({ wb }, i) => {
      wb.syncLayout();
      if (!wb.storage.saveNamed(i.name, wb.getDoc())) throw new Error("The workspace could not be stored.");
    },
  });

  c.register({
    id: "workspace.load",
    title: "Load workspace",
    category: "Workspace",
    risk: "local",
    input: z.object({ name: z.string() }),
    expand: (wb) => wb.storage.names().map((name) => ({ title: `Load workspace: ${name}`, input: { name } })),
    run: ({ wb }, i) => {
      const raw = wb.storage.loadNamed(i.name);
      if (raw === undefined) throw new Error(`No saved workspace named "${i.name}".`);
      return wb.loadDoc(raw);
    },
  });

  c.register({
    id: "workspace.delete",
    title: "Delete saved workspace",
    category: "Workspace",
    risk: "irreversible",
    input: z.object({ name: z.string() }),
    run: ({ wb }, i) => wb.storage.deleteNamed(i.name),
  });

  c.register({
    id: "workspace.reset",
    title: "Reset workspace to default",
    category: "Workspace",
    risk: "local",
    run: ({ wb }) => wb.reset(),
  });

  c.register({
    id: "workspace.preset",
    title: "Switch to preset workspace",
    category: "Workspace",
    risk: "local",
    input: z.object({ name: z.string() }),
    when: (wb) => Object.keys(wb.config.presets ?? {}).length > 0,
    expand: (wb) => Object.keys(wb.config.presets ?? {}).map((name) => ({ title: `Preset workspace: ${name}`, input: { name } })),
    run: ({ wb }, i) => wb.loadPreset(i.name),
  });

  c.register({
    id: "workspace.export",
    title: "Export workspace as JSON",
    category: "Workspace",
    risk: "read",
    input: z.object({}),
    palette: false, // the Workspaces side view offers this as a download
    run: ({ wb }) => (wb.syncLayout(), wb.getDoc()),
  });

  c.register({
    id: "workspace.import",
    title: "Import workspace from JSON",
    category: "Workspace",
    risk: "local",
    input: z.object({ doc: z.unknown() }),
    run: ({ wb }, i) => wb.loadDoc(i.doc),
  });

  c.register({
    id: "settings.set",
    title: "Change a setting",
    category: "Settings",
    risk: "local",
    input: z.object({ key: z.string(), value: z.unknown() }),
    // Returns the previous value, which is what undo puts back.
    run: ({ wb }, i) => wb.settings.set(i.key, i.value),
    undo: ({ wb }, i, previous) => void wb.settings.set(i.key, previous),
  });

  c.register({
    id: "settings.open",
    title: "Settings",
    category: "Settings",
    risk: "local",
    log: false,
    keys: "mod+,",
    input: z.object({ section: z.string().optional().describe("Section to open, e.g. \"Appearance\"") }).optional(),
    run: ({ wb }, i?: { section?: string }) => wb.setMeta({ dialog: "settings", dialogSection: i?.section ? { section: i.section } : null }),
  });

  c.register({
    id: "docs.open",
    title: "Documentation",
    category: "Settings",
    risk: "local",
    log: false,
    input: z.object({ page: z.string().optional().describe("Id of the page to show; docs.list gives the ids") }).optional(),
    run: ({ wb }, i?: { page?: string }) => wb.setMeta({ dialog: "settings", dialogSection: { section: "Documentation", page: i?.page } }),
  });

  c.register({
    id: "docs.list",
    title: "List the documentation pages",
    category: "Settings",
    risk: "read",
    palette: false,
    input: z.object({ page: z.string().optional().describe("Return this page's text as well") }).optional(),
    run: ({ wb }, i?: { page?: string }) => {
      const pages = documentation(wb);
      const wanted = i?.page ? pages.find((p) => p.id === i.page) : undefined;
      if (i?.page && !wanted) throw new Error(`There is no documentation page "${i.page}".`);
      return { pages: pages.map(({ id, title }) => ({ id, title })), ...(wanted ? { page: wanted } : {}) };
    },
  });

  c.register({
    id: "assistant.setup",
    title: "Assistant setup: connect an agent",
    category: "Assistant",
    risk: "local",
    log: false,
    run: ({ wb }) => wb.setMeta({ dialog: "assistant" }),
  });

  c.register({
    id: "custom.save",
    title: "Save custom element",
    category: "Custom elements",
    risk: "local",
    input: z.object({
      id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/, "Use lowercase letters, digits and dashes, starting with a letter.").describe("Lowercase letters, digits and dashes; the same id replaces the element"),
      title: z.string().trim().min(2, "Give the element a title.").max(60),
      description: z.string().max(400).optional(),
      source: z.string().min(1, "The element has no source.").max(200_000).describe("The whole element: one HTML document with inline style and script"),
    }),
    run: ({ wb, actor }, i) => ({ id: i.id, previous: wb.custom.save({ ...i, author: wb.custom.get(i.id)?.author ?? actor }) ?? null }),
    undo: ({ wb }, i, result) => {
      const previous = (result as { previous: import("./custom").CustomElement | null }).previous;
      if (previous) wb.custom.restore(previous);
      else wb.custom.remove(i.id);
    },
  });

  c.register({
    id: "custom.delete",
    title: "Delete custom element",
    category: "Custom elements",
    risk: "local",
    input: z.object({ id: z.string() }),
    run: ({ wb }, i) => {
      const removed = wb.custom.remove(i.id);
      if (!removed) throw new Error(`No custom element called "${i.id}".`);
      return removed;
    },
    undo: ({ wb }, _i, removed) => wb.custom.restore(removed as import("./custom").CustomElement),
  });

  c.register({
    id: "custom.submit",
    title: "Submit custom element for review",
    category: "Custom elements",
    // It leaves the person's browser for a reviewer, so an agent may not do it unasked.
    risk: "external",
    input: z.object({ id: z.string(), notes: z.string().max(2000).optional() }),
    run: async ({ wb }, i) => {
      const submission = wb.submissionFor(i.id, i.notes ?? "");
      const delivered = await wb.config.custom?.submit?.(submission);
      wb.custom.markSubmitted(i.id);
      return { submission, url: delivered?.url ?? null, delivered: Boolean(wb.config.custom?.submit) };
    },
  });

  c.register({
    id: "history.undo",
    title: "Undo last workspace action",
    category: "Workspace",
    risk: "local",
    log: false,
    when: (wb) => wb.getMeta().log.some((e) => e.before && !e.undone),
    run: ({ wb }) => wb.undo()?.title ?? null,
  });
}
