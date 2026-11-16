import { useEffect, useMemo, useRef, useState } from "react";
import { LIBRARY_TAG, librariesOf, type CustomElement, type Werkbank } from "../core";

/**
 * Runs a custom element. The element's code is not trusted the way the app's
 * own code is, so it gets:
 *  - a frame with a unique origin (it cannot reach the app's page or storage),
 *  - a content policy that blocks every network request,
 *  - and a message-based API that only reads the app's data, sets shared
 *    context, keeps the element's own state, and calls functions the app has
 *    chosen to offer. It cannot run commands.
 */
const TOKENS = [
  "--wb-font", "--wb-mono", "--wb-font-size", "--wb-canvas", "--wb-canvas-alt", "--wb-face", "--wb-text", "--wb-text-dim",
  "--wb-border", "--wb-grid", "--wb-accent", "--wb-accent-text", "--wb-hover", "--wb-good", "--wb-bad", "--wb-warn", "--wb-radius", "--wb-row-h",
];
const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";
const STATE_LIMIT = 100_000;

/** Runs inside the frame: the `werkbank` object the element's code talks to. */
const BOOTSTRAP = `(() => {
  let n = 0;
  const waiting = new Map();
  const linkSubs = new Map();
  const themeSubs = [];
  const ask = (method, args) => new Promise((resolve, reject) => {
    const id = ++n;
    waiting.set(id, { resolve, reject });
    parent.postMessage({ wb: 1, id, method, args }, "*");
  });
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.wb !== 1) return;
    if (m.id && waiting.has(m.id)) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? w.reject(new Error(m.error)) : w.resolve(m.value);
    } else if (m.event === "link") (linkSubs.get(m.topic) || []).forEach((f) => f(m.value));
    else if (m.event === "theme") {
      for (const k in m.tokens) document.documentElement.style.setProperty(k, m.tokens[k]);
      themeSubs.forEach((f) => f());
    }
  });
  const report = (message) => parent.postMessage({ wb: 1, event: "error", message: String(message) }, "*");
  // Tell the app this frame is up, so it can tell a loaded element from a frame that never loaded.
  parent.postMessage({ wb: 1, event: "ready" }, "*");
  addEventListener("error", (e) => report(e.message));
  addEventListener("unhandledrejection", (e) => report((e.reason && e.reason.message) || e.reason));
  window.werkbank = {
    panels: () => ask("panels"),
    data: (id) => ask("data", { id }),
    link: (topic) => ask("link", { topic }),
    onLink: (topic, f) => {
      if (!linkSubs.has(topic)) linkSubs.set(topic, []);
      linkSubs.get(topic).push(f);
      ask("watch", { topic }).then(f);
    },
    publish: (topic, value) => ask("publish", { topic, value }),
    getState: () => ask("getState"),
    setState: (value) => ask("setState", { value }),
    call: (name, args) => ask("call", { name, args }),
    onTheme: (f) => themeSubs.push(f),
  };
})();`;

/** Library code, fetched once per app however many elements use it. */
const loaded = new WeakMap<Werkbank, Map<string, Promise<string>>>();
function library(wb: Werkbank, name: string): Promise<string> {
  const cache = loaded.get(wb) ?? new Map<string, Promise<string>>();
  loaded.set(wb, cache);
  const spec = wb.config.custom?.libraries?.[name];
  if (!spec) return Promise.reject(new Error(`This app provides no library called "${name}".`));
  if (!cache.has(name)) cache.set(name, spec.load());
  return cache.get(name)!;
}
/** Library code as an inline script. The two replacements keep the HTML parser from ending the script early. */
const inline = (code: string) => `<script>${code.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--")}<\/script>`;

const page = (source: string, tokens: Record<string, string>) => `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${POLICY}">
<style>:root{${Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(";")}}
html,body{margin:0;height:100%}
body{background:var(--wb-canvas);color:var(--wb-text);font:var(--wb-font-size)/1.4 var(--wb-font);overflow:auto}
*{box-sizing:border-box}</style>
<script>${BOOTSTRAP}<\/script></head><body>
${source}
</body></html>`;

export function Sandbox({ wb, element, instanceId, theme }: { wb: Werkbank; element: CustomElement; instanceId: string | null; theme: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Record<string, string> | null>(null);
  const ready = useRef(false);

  // Theme tokens are read from the page the frame sits in (which may be a popout window).
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const view = el.ownerDocument.defaultView ?? window;
    const read = () => {
      const css = view.getComputedStyle(el);
      const next = Object.fromEntries(TOKENS.map((name) => [name, css.getPropertyValue(name).trim()]));
      if (!tokens) setTokens(next);
      else frame.current?.contentWindow?.postMessage({ wb: 1, event: "theme", tokens: next }, "*");
    };
    if (!tokens) return read();
    // The shell applies a new theme to the page after this runs, so the tokens are read on the next frame.
    const later = view.requestAnimationFrame(read);
    return () => view.cancelAnimationFrame(later);
  }, [theme, tokens]);

  // The libraries the element asks for are put into its frame as inline code: it cannot fetch them itself.
  const wanted = librariesOf(element.source).join(" ");
  const [libraries, setLibraries] = useState<{ for: string; code: Record<string, string> } | null>(wanted ? null : { for: "", code: {} });
  useEffect(() => {
    if (libraries?.for === wanted) return;
    let current = true;
    const names = wanted ? wanted.split(" ") : [];
    Promise.all(names.map((name) => library(wb, name)))
      .then((codes) => current && setLibraries({ for: wanted, code: Object.fromEntries(names.map((name, i) => [name, codes[i]!])) }))
      .catch((e) => current && setError(e instanceof Error ? e.message : String(e)));
    return () => void (current = false);
  }, [wb, wanted, libraries]);
  const ready_ = tokens !== null && libraries?.for === wanted;
  const html = useMemo(
    () => (ready_ ? page(element.source.replace(LIBRARY_TAG, (_tag, name: string) => inline(libraries!.code[name] ?? "")), tokens!) : ""),
    [element.source, element.revision, ready_],
  );
  useEffect(() => {
    if (html) setError(null);
  }, [html]);

  // The layout may relocate a panel while its frame is still loading, which can leave the frame
  // empty. If the element has not reported in shortly after its content was set, set it again.
  useEffect(() => {
    if (!html) return;
    ready.current = false;
    let tries = 0;
    const timer = setInterval(() => {
      if (ready.current || ++tries > 5) return clearInterval(timer);
      if (frame.current) frame.current.srcdoc = html;
    }, 500);
    return () => clearInterval(timer);
  }, [html]);

  useEffect(() => {
    const view = holder.current?.ownerDocument.defaultView;
    if (!view) return;
    const watched = new Map<string, string>();
    const linkValue = (topic: string) => (instanceId ? wb.linksOf(instanceId)[topic] : undefined) ?? null;
    const post = (message: object) => frame.current?.contentWindow?.postMessage({ wb: 1, ...message }, "*");

    const answer = (method: string, args: Record<string, unknown> = {}): unknown => {
      switch (method) {
        case "panels":
          return (wb.describe({ detail: "summary" }) as { panels: { id: string; tool: string; title: string; linkGroup: string | null }[] }).panels.map(({ id, tool, title, linkGroup }) => ({ id, tool, title, linkGroup }));
        case "data": {
          const view = wb.describe(typeof args.id === "string" ? { panels: [args.id] } : {}) as { panels: { id: string; data: unknown }[] };
          if (typeof args.id !== "string") return { panels: view.panels.map(({ id, data }) => ({ id, data })) };
          if (!view.panels[0]) throw new Error(`No panel "${args.id}" is open.`);
          return view.panels[0].data ?? null;
        }
        case "link":
          return linkValue(String(args.topic));
        case "watch":
          watched.set(String(args.topic), JSON.stringify(linkValue(String(args.topic))));
          return linkValue(String(args.topic));
        case "publish":
          if (!instanceId) throw new Error("A preview cannot change shared context.");
          wb.publish(instanceId, String(args.topic), args.value);
          return true;
        case "getState":
          return instanceId ? ((wb.getDoc().instances[instanceId]?.state as { saved?: unknown })?.saved ?? null) : null;
        case "setState":
          if (JSON.stringify(args.value ?? null).length > STATE_LIMIT) throw new Error("That is too much state to save.");
          if (instanceId) wb.setState(instanceId, { saved: args.value ?? null });
          return true;
        case "call": {
          const fn = wb.config.custom?.hostFunctions?.[String(args.name)];
          if (!fn) throw new Error(`The app offers no function called "${args.name}".`);
          return fn.run(args.args, wb);
        }
        default:
          throw new Error(`Unknown request: ${method}`);
      }
    };

    const onMessage = async (event: MessageEvent) => {
      // Only this element's own frame is listened to.
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data as { wb?: number; id?: number; method?: string; args?: Record<string, unknown>; event?: string; message?: string };
      if (message?.wb !== 1) return;
      if (message.event === "ready") return void (ready.current = true);
      if (message.event === "error") return setError(message.message ?? "The element reported an error.");
      if (!message.id || !message.method) return;
      try {
        post({ id: message.id, value: await answer(message.method, message.args) });
      } catch (e) {
        post({ id: message.id, error: e instanceof Error ? e.message : String(e) });
      }
    };
    view.addEventListener("message", onMessage);
    const offDoc = wb.subscribeDoc(() => {
      for (const [topic, last] of watched) {
        const now = JSON.stringify(linkValue(topic));
        if (now === last) continue;
        watched.set(topic, now);
        post({ event: "link", topic, value: linkValue(topic) });
      }
    });
    return () => {
      view.removeEventListener("message", onMessage);
      offDoc();
    };
  }, [wb, instanceId, html]);

  return (
    <div className="wb-sandbox" ref={holder}>
      {error && (
        <div className="wb-sandbox-error" role="alert">
          The element reported an error: {error}
        </div>
      )}
      {/* Created only once its content is ready, and anew for each revision of the element. */}
      {!html && wanted && !error && <p className="wb-hint">Loading {wanted.split(" ").join(", ")}…</p>}
      {html && <iframe key={element.revision} ref={frame} title={element.title} sandbox="allow-scripts" srcDoc={html} className="wb-sandbox-frame" />}
    </div>
  );
}
