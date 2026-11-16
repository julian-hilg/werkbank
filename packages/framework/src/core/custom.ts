import { z } from "zod";
import type { KeyValueStore } from "./storage";

/**
 * Custom elements: panels a person builds for themselves inside the app,
 * usually by describing them to an agent. They are local to the person's
 * browser, run in a sandbox with no network access, and reach the app only
 * through a small read-mostly API. One can be submitted for review, which is
 * the path into the shared app. See docs/custom-elements.md.
 */
export const CustomElementSchema = z.object({
  /** Lowercase letters, digits and dashes. */
  id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  title: z.string().trim().min(2).max(60),
  description: z.string().max(400),
  /** HTML with inline script and style. It is the whole element. */
  source: z.string().min(1).max(200_000),
  author: z.string().max(80),
  created: z.string(),
  updated: z.string(),
  /** Increases on every save. */
  revision: z.number().int().min(1),
  status: z.enum(["draft", "submitted"]),
});
export type CustomElement = z.infer<typeof CustomElementSchema>;

/** What travels to a reviewer when an element is submitted. */
export interface ElementSubmission {
  kind: "werkbank-element-submission";
  app: string;
  frameworkVersion: string;
  submitted: string;
  element: CustomElement;
  /** The app calls the element's code uses, found by scanning its source. Reviewers start here. */
  uses: { api: string[]; hostFunctions: string[]; libraries: string[] };
  notes: string;
}

type Listener = () => void;

export class CustomElementStore {
  private elements: CustomElement[] = [];
  private listeners = new Set<Listener>();
  private key: string;

  constructor(
    private store: KeyValueStore,
    appId: string,
  ) {
    this.key = `${appId}.custom-elements`;
    try {
      const raw = JSON.parse(this.store.getItem(this.key) ?? "[]");
      const parsed = z.array(CustomElementSchema).safeParse(raw);
      if (parsed.success) this.elements = parsed.data;
    } catch {
      /* start with none */
    }
  }

  list = (): CustomElement[] => this.elements;
  get = (id: string): CustomElement | undefined => this.elements.find((e) => e.id === id);
  subscribe = (fn: Listener) => (this.listeners.add(fn), () => void this.listeners.delete(fn));

  /** Create or replace. Returns the element as it was before, if it existed. */
  save(input: Pick<CustomElement, "id" | "title" | "source"> & Partial<Pick<CustomElement, "description" | "author">>): CustomElement | undefined {
    const before = this.get(input.id);
    const now = new Date().toISOString();
    const element = CustomElementSchema.parse({
      id: input.id,
      title: input.title,
      description: input.description ?? before?.description ?? "",
      source: input.source,
      author: input.author ?? before?.author ?? "",
      created: before?.created ?? now,
      updated: now,
      revision: (before?.revision ?? 0) + 1,
      // Changing an element after submitting it makes it a draft again: what was reviewed is no longer what runs.
      status: "draft",
    });
    this.commit(before ? this.elements.map((e) => (e.id === input.id ? element : e)) : [...this.elements, element]);
    return before;
  }

  /** Put back exactly what was there (used by undo). */
  restore(element: CustomElement): void {
    this.commit(this.get(element.id) ? this.elements.map((e) => (e.id === element.id ? element : e)) : [...this.elements, element]);
  }

  remove(id: string): CustomElement | undefined {
    const before = this.get(id);
    if (before) this.commit(this.elements.filter((e) => e.id !== id));
    return before;
  }

  markSubmitted(id: string): void {
    this.commit(this.elements.map((e) => (e.id === id ? { ...e, status: "submitted" as const } : e)));
  }

  private commit(elements: CustomElement[]): void {
    this.elements = elements;
    try {
      this.store.setItem(this.key, JSON.stringify(elements));
    } catch {
      /* kept in memory for this page load */
    }
    this.listeners.forEach((fn) => fn());
  }
}

/** The calls an element can make. The same text briefs the agent that writes one. */
export const ELEMENT_API = `A custom element is one HTML document (inline <style> and <script> only) shown in a sandboxed frame.
It has no network access: fetch, XMLHttpRequest, external scripts, images and fonts are all blocked. Use plain DOM, SVG or canvas,
or a library the app provides: \`<script src="lib:NAME"></script>\` loads one (the app's list of libraries says which exist and
which global each defines). No other script src works.

A global object \`werkbank\` is available:
  await werkbank.panels()                 -> [{ id, tool, title, linkGroup }] of the panels open in the app
  await werkbank.data(panelId)            -> the data behind that panel's view (what the app reports about it)
  await werkbank.data()                   -> { panels: [...] } with the data of every open panel (can be large)
  await werkbank.link(topic)              -> the current value of a shared context topic, e.g. "symbol"
  werkbank.onLink(topic, (value) => {})   -> called now and whenever that topic changes
  await werkbank.publish(topic, value)    -> set a shared context topic (validated by the app)
  await werkbank.getState()               -> this element's own saved state (any JSON), or null
  await werkbank.setState(value)          -> save it (survives reloads and moving the panel)
  await werkbank.call(name, args)         -> call a function the app offers to elements (see "host functions")
  werkbank.onTheme(() => {})              -> called when the theme changes

Styling: these CSS variables follow the app's theme and must be used instead of literal colours:
  --wb-canvas (background) --wb-canvas-alt --wb-text --wb-text-dim --wb-border --wb-grid
  --wb-accent --wb-accent-text --wb-good (gain) --wb-bad (loss) --wb-warn --wb-font --wb-mono --wb-font-size
The document body already uses the app's font, text colour and background.

Rules: no external resources; read data through \`werkbank\`, never invent it; show a short message when the
data you need is not open in the app; refresh by calling werkbank.data again on a timer (once a second at most).`;

/** Which API calls an element's source uses: the reviewer's starting point. */
/** The libraries an element asks for with `<script src="lib:NAME">`. */
export const LIBRARY_TAG = /<script\s+src\s*=\s*["']lib:([\w.-]+)["']\s*>\s*<\/script>/gi;
export const librariesOf = (source: string): string[] => [...new Set([...source.matchAll(LIBRARY_TAG)].map((m) => m[1]!))];

export function scanElement(source: string): { api: string[]; hostFunctions: string[]; libraries: string[] } {
  const api = [...new Set([...source.matchAll(/werkbank\.(\w+)\s*\(/g)].map((m) => m[1]!))].sort();
  const hostFunctions = [...new Set([...source.matchAll(/werkbank\.call\(\s*["'`]([\w.-]+)["'`]/g)].map((m) => m[1]!))].sort();
  return { api, hostFunctions, libraries: librariesOf(source) };
}
