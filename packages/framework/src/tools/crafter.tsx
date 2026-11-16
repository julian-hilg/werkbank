import { useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { getAgentLink, requestAgentConnection, type ChatEvent } from "../bridge-client";
import { ELEMENT_API, scanElement, type CustomElement, type ElementSubmission, type Werkbank } from "../core";
import { openContextMenu } from "../menu";
import { defineTool, useDoc, useMeta, useToolState, useWerkbank } from "./index";
import { Sandbox } from "./Sandbox";

/**
 * The Crafter: where a person builds panels of their own, usually by
 * describing them to an agent. What is built here is a custom element: it is
 * stored in this browser only, runs in a sandbox with no network access, and
 * is listed among the tools with "(C)" after its name. "Submit for review"
 * packages one for the people who maintain the shared app.
 */
const stateSchema = z.object({
  selected: z.string().nullable(),
  tab: z.enum(["preview", "source", "api"]),
  prompt: z.string().max(4000),
  /** Source being edited by hand, per element, until it is saved. */
  edits: z.record(z.string(), z.string().max(200_000)),
});
type State = z.infer<typeof stateSchema>;

const STARTER = `<style>
  body { padding: 10px; }
  h1 { margin: 0 0 6px; font-size: 1.1em; }
  li { line-height: 1.6; }
  .dim { color: var(--wb-text-dim); }
</style>
<h1>My element</h1>
<p class="dim">Linked symbol: <strong id="symbol">none</strong></p>
<ul id="panels"></ul>
<script>
  // Follow the shared "symbol" context, and list what is open in the app.
  werkbank.onLink("symbol", (value) => {
    document.getElementById("symbol").textContent = value ?? "none";
  });
  werkbank.panels().then((panels) => {
    document.getElementById("panels").innerHTML = panels.map((p) => "<li>" + p.title + " <span class='dim'>" + p.id + "</span></li>").join("");
  });
</script>`;

/** What the agent is told when asked to build or change an element. */
function brief(wb: Werkbank, element: CustomElement, request: string): string {
  const functions = Object.entries(wb.config.custom?.hostFunctions ?? {});
  const panels = (wb.describe({ detail: "summary" }) as { panels: { id: string; tool: string; title: string }[] }).panels;
  const libraries = Object.entries(wb.config.custom?.libraries ?? {});
  return [
    `You are building a custom element for the app "${wb.config.title}". The user described what they want in the Crafter panel; the request is at the end.`,
    ELEMENT_API,
    libraries.length
      ? `Libraries this app provides (load with <script src="lib:NAME"></script> before your own script; each defines a global):\n${libraries.map(([name, l]) => `  ${name}: global \`${l.global}\`. ${l.title}. ${l.description}`).join("\n")}\nRead colours from the CSS variables (getComputedStyle(document.documentElement).getPropertyValue("--wb-accent")) and redraw in werkbank.onTheme.`
      : "This app provides no libraries; use plain DOM, SVG or canvas.",
    functions.length ? `Host functions this app offers through werkbank.call:\n${functions.map(([name, f]) => `  ${name}: ${f.description}`).join("\n")}` : "This app offers no host functions.",
    `Panels open right now (their ids work with werkbank.data): ${panels.map((p) => `${p.id} (${p.tool})`).join(", ")}. To see the exact shape of a panel's data, call werkbank_describe with that panel's id before you write code that reads it. The element must also cope with that panel not being open.`,
    `When the element is ready, save it by calling werkbank_run with id "custom.save" and input { "id": "${element.id}", "title": <short title>, "description": <one sentence>, "source": <the complete HTML document> }. Saving replaces the whole element, so always send the complete source. Do not paste the code into your reply; answer with one or two sentences about what you built or changed.`,
    `The element so far (id "${element.id}", title "${element.title}"):\n\`\`\`html\n${element.source}\n\`\`\``,
    `The request: ${request}`,
  ].join("\n\n");
}

/** One build at a time, whichever Crafter panel started it. */
const panelKey = "crafter";
/** Builds in flight. */
const builds = new Map<string, { stop: () => void; lines: string[] }>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
const lastLines = new Map<string, string[]>();

async function build(wb: Werkbank, panelId: string, element: CustomElement, request: string): Promise<void> {
  const job = { stop: () => {}, lines: ["connecting…"] };
  builds.set(panelId, job);
  changed();
  const say = (line: string) => {
    job.lines = [...job.lines.filter((l) => !l.endsWith("…")), line].slice(-8);
    changed();
  };
  const finish = () => {
    lastLines.set(panelId, job.lines);
    builds.delete(panelId);
    changed();
  };
  if (wb.getMeta().bridge === "off") requestAgentConnection(wb);
  for (let waited = 0; waited < 6000 && !(wb.getMeta().bridge === "connected" && getAgentLink(wb)); waited += 100) await new Promise((r) => setTimeout(r, 100));
  const link = getAgentLink(wb);
  if (!link || wb.getMeta().bridge !== "connected") {
    say("Could not reach the agent bridge. Start it with `npm run dev`, or write the source by hand.");
    return finish();
  }
  const onEvent = (event: ChatEvent) => {
    if (event.type === "status") say(`${event.text}…`);
    else if (event.type === "text") say(event.text);
    else if (event.type === "tool") {
      const input = event.input as { id?: string } | undefined;
      say(input?.id === "custom.save" ? "✓ saved the element" : `· ${input?.id ?? event.name.replace(/^.*werkbank_/, "")}`);
    } else if (event.type === "done") {
      if (event.error) say(`Stopped: ${event.error}`);
      finish();
    }
  };
  const agent = wb.settings.get<string>("assistant.agent") || wb.getMeta().assistant?.defaultAgent || null;
  job.stop = link.chat(brief(wb, element, request), null, onEvent, { agent }).stop;
}

function download(name: string, text: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function Crafter() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const elements = useSyncExternalStore(wb.custom.subscribe, wb.custom.list);
  const theme = useDoc((doc) => doc.shell.theme);
  const bridge = useMeta((meta) => meta.bridge);
  const job = useSyncExternalStore(subscribe, () => builds.get(panelKey));
  const [notice, setNotice] = useState<string | null>(null);
  const element = elements.find((e) => e.id === state.selected) ?? null;
  const edited = element ? state.edits[element.id] : undefined;
  const lines = job?.lines ?? lastLines.get(panelKey) ?? [];
  const functions = Object.entries(wb.config.custom?.hostFunctions ?? {});

  const report = async (work: Promise<{ ok: boolean; error?: string }>, done?: string) => {
    const result = await work;
    setNotice(result.ok ? (done ?? null) : (result.error ?? "That did not work."));
    return result.ok;
  };
  const create = async () => {
    let n = elements.length + 1;
    while (wb.custom.get(`element-${n}`)) n++;
    if (await report(wb.run("custom.save", { id: `element-${n}`, title: `Element ${n}`, description: "", source: STARTER }))) setState({ ...state, selected: `element-${n}`, tab: "preview" });
  };
  const file = useRef<HTMLInputElement>(null);
  /** An exported element, or a submission package, becomes one of the person's own elements. */
  const importFile = async (picked: File | undefined) => {
    if (!picked) return;
    let incoming: { id?: unknown; title?: unknown; description?: unknown; source?: unknown };
    try {
      const parsed = JSON.parse(await picked.text());
      incoming = parsed?.element ?? parsed;
    } catch {
      return setNotice("That file is not JSON.");
    }
    if (typeof incoming?.id !== "string" || typeof incoming.source !== "string") return setNotice("That file does not contain an element.");
    // An import never overwrites an element the person already has.
    let id = incoming.id;
    for (let n = 2; wb.custom.get(id); n++) id = `${incoming.id}-${n}`;
    const title = typeof incoming.title === "string" ? incoming.title : id;
    if (await report(wb.run("custom.save", { id, title, description: typeof incoming.description === "string" ? incoming.description : "", source: incoming.source }), `Imported "${title}". It runs in the same sandbox as an element you build here.`))
      setState({ ...state, selected: id, tab: "preview" });
  };
  const saveSource = async () => {
    if (!element || edited === undefined) return;
    if (await report(wb.run("custom.save", { id: element.id, title: element.title, description: element.description, source: edited }), "Saved.")) {
      const { [element.id]: _dropped, ...edits } = state.edits;
      setState({ ...state, edits });
    }
  };
  const submit = async () => {
    if (!element) return;
    const result = await wb.run("custom.submit", { id: element.id, notes: state.prompt });
    if (!result.ok) return setNotice(result.error);
    const { submission, url, delivered } = result.value as { submission: ElementSubmission; url: string | null; delivered: boolean };
    // Without a place to send it, the package is handed to the person to pass on.
    if (!delivered) download(`${element.id}.element.json`, JSON.stringify(submission, null, 2));
    setNotice(delivered ? `Submitted for review${url ? `: ${url}` : "."}` : `Saved ${element.id}.element.json. Send it to the app's maintainers; docs/custom-elements.md describes what happens next.`);
  };

  return (
    <div className="wb-crafter">
      <aside className="wb-crafter-list">
        <button className="wb-button" onClick={() => void create()}>
          New element
        </button>
        <button className="wb-button" title="Add an element from an .element.json file that you or a colleague exported" onClick={() => file.current?.click()}>
          Import from file
        </button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => (void importFile(e.target.files?.[0]), (e.target.value = ""))} />
        {elements.map((e) => (
          <button
            key={e.id}
            className="wb-list-item"
            aria-current={e.id === state.selected || undefined}
            onClick={() => (setNotice(null), setState({ ...state, selected: e.id }))}
            onContextMenu={(event) =>
              openContextMenu(wb, event, [
                { label: "Open as a panel", run: () => void wb.run("panel.open", { toolId: `c-${e.id}` }) },
                { separator: true },
                { label: "Delete element", danger: true, run: () => void report(wb.run("custom.delete", { id: e.id })) },
              ])
            }
          >
            <span className="wb-crafter-name">{e.title} (C)</span>
            <span className="wb-badge" data-tone={e.status === "submitted" ? undefined : "warn"}>
              {e.status === "submitted" ? "submitted" : "draft"}
            </span>
          </button>
        ))}
        {elements.length === 0 && <p className="wb-hint">Nothing yet. Elements you build are yours alone until you submit one.</p>}
        <p className="wb-hint wb-crafter-foot">Custom elements are stored in this browser, run in a sandbox without network access, and are marked (C) wherever they are listed.</p>
      </aside>
      {!element ? (
        <div className="wb-crafter-empty">
          <p>Build a panel of your own: create an element, then describe what it should show.</p>
          <button className="wb-button" onClick={() => void create()}>
            New element
          </button>
        </div>
      ) : (
        <div className="wb-crafter-main">
          <div className="wb-toolhead">
            <input
              className="wb-input"
              style={{ maxWidth: 200 }}
              aria-label="Element title"
              value={element.title}
              onChange={(e) => e.target.value.trim().length >= 2 && void wb.run("custom.save", { id: element.id, title: e.target.value, description: element.description, source: element.source })}
            />
            <span className="wb-badge">revision {element.revision}</span>
            <span className="wb-segment" role="group" aria-label="View">
              {(["preview", "source", "api"] as const).map((tab) => (
                <button key={tab} className="wb-button" aria-pressed={state.tab === tab} onClick={() => setState({ ...state, tab })}>
                  {tab === "preview" ? "Preview" : tab === "source" ? "Source" : "API"}
                </button>
              ))}
            </span>
            <span style={{ flex: 1 }} />
            <button className="wb-button" onClick={() => void report(wb.run("panel.open", { toolId: `c-${element.id}` }))}>
              Open as a panel
            </button>
            <button className="wb-button" title="Save this element as a file, to keep or to pass to a colleague" onClick={() => download(`${element.id}.element.json`, JSON.stringify({ kind: "werkbank-element", element }, null, 2))}>
              Export
            </button>
            <button className="wb-button" title="Package this element for the people who maintain the shared app" onClick={() => void submit()}>
              Submit for review
            </button>
          </div>
          <form
            className="wb-crafter-ask"
            onSubmit={(e) => {
              e.preventDefault();
              if (state.prompt.trim() && !job) void build(wb, panelKey, element, state.prompt.trim());
            }}
          >
            <textarea
              className="wb-input"
              rows={2}
              value={state.prompt}
              aria-label="Describe what to build or change"
              placeholder={`Describe what to build or change, for example "show my five largest positions as bars, coloured by today's change"`}
              onChange={(e) => setState({ ...state, prompt: e.target.value })}
            />
            {job ? (
              <button className="wb-button" type="button" onClick={() => job.stop()}>
                Stop
              </button>
            ) : (
              <button className="wb-button" type="submit" disabled={!state.prompt.trim()} title={bridge === "connected" ? "Hand this to the agent chosen in the assistant setup" : "Needs the agent bridge"}>
                Build with the assistant
              </button>
            )}
          </form>
          {(lines.length > 0 || notice) && (
            <div className="wb-crafter-log" role="status">
              {lines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              {notice && <div>{notice}</div>}
            </div>
          )}
          <div className="wb-crafter-view">
            {state.tab === "preview" && <Sandbox wb={wb} element={element} instanceId={null} theme={theme} />}
            {state.tab === "source" && (
              <>
                <textarea
                  className="wb-crafter-source"
                  spellCheck={false}
                  aria-label="Element source"
                  value={edited ?? element.source}
                  onChange={(e) => setState({ ...state, edits: { ...state.edits, [element.id]: e.target.value } })}
                />
                <div className="wb-form-actions wb-crafter-actions">
                  <button className="wb-button" disabled={edited === undefined} onClick={() => void saveSource()}>
                    Save source
                  </button>
                  <button
                    className="wb-button"
                    disabled={edited === undefined}
                    onClick={() => {
                      const { [element.id]: _dropped, ...edits } = state.edits;
                      setState({ ...state, edits });
                    }}
                  >
                    Discard changes
                  </button>
                  <span className="wb-hint">Uses: {scanElement(edited ?? element.source).api.join(", ") || "nothing from the app yet"}</span>
                </div>
              </>
            )}
            {state.tab === "api" && (
              <pre className="wb-crafter-api">
                {ELEMENT_API}
                {"\n\n"}Host functions in this app:{"\n"}
                {functions.length ? functions.map(([name, f]) => `  ${name}: ${f.description}`).join("\n") : "  none"}
                {"\n\n"}Libraries in this app (load with {'<script src="lib:NAME"></script>'}):{"\n"}
                {Object.entries(wb.config.custom?.libraries ?? {}).map(([name, l]) => `  ${name}: global ${l.global}. ${l.title}. ${l.description}`).join("\n") || "  none"}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Add this to an app's `tools` to let people build elements of their own. */
export const crafterTool = defineTool<State>({
  id: "crafter",
  title: "Crafter",
  glyph: "✧",
  category: "Custom",
  keepAcrossWorkspaces: true,
  version: 1,
  stateSchema,
  defaultState: () => ({ selected: null, tab: "preview", prompt: "", edits: {} }),
  component: Crafter,
  describe: (state) => ({
    selected: state.selected,
    note: "Where the user builds custom elements. Save one with the custom.save command; custom elements run in a sandbox and are listed with (C).",
  }),
});
