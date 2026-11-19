import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { FRAMEWORK_VERSION, assistantSetup, documentation, type SettingSpec } from "../core";
import { getAgentLink } from "../bridge-client";
import { copyText } from "../menu";
import { Select } from "../controls";
import { useDoc, useMeta, useWerkbank } from "../tools";
import { Markdown } from "../tools/Markdown";

/** A modal window above the workspace. Escape or the close button dismisses it. */
function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-autofocus], input, button")?.focus();
  }, []);
  // Escape closes the window wherever the focus is, including after a field was left.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // An open dropdown or search list takes the first Escape.
      if ((e.target as Element | null)?.closest?.("[aria-expanded=true]")) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="wb-overlay wb-overlay-centre" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="wb-window" data-wide={wide || undefined} role="dialog" aria-modal="true" aria-label={title}>
        <header className="wb-window-head">
          <h2>{title}</h2>
          <button className="wb-tool-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="wb-button"
      onClick={() => {
        copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

// ---- settings -------------------------------------------------------------------

/** One setting, with a control chosen from its spec. Changes go through the command registry. */
function SettingRow({ spec }: { spec: SettingSpec<any> }) {
  const wb = useWerkbank();
  const value = useSyncExternalStore(wb.settings.subscribe, () => wb.settings.get(spec.key));
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const set = async (next: unknown) => {
    const result = await wb.run("settings.set", { key: spec.key, value: next });
    setError(result.ok ? null : "That value is not allowed here.");
    if (result.ok) setDraft(null);
  };
  const control = spec.control ?? (typeof spec.default === "boolean" ? "switch" : spec.options ? "select" : typeof spec.default === "number" ? "number" : "text");
  const id = `setting-${spec.key}`;
  return (
    <div className="wb-setting" data-invalid={error ? true : undefined}>
      <div className="wb-setting-text">
        <label htmlFor={id}>{spec.title}</label>
        {spec.description && <p>{spec.description}</p>}
        {error && <p className="wb-control-error" role="alert">{error}</p>}
      </div>
      <div className="wb-setting-control">
        {control === "switch" ? (
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => void set(e.target.checked)} />
        ) : control === "select" ? (
<Select id={id} value={String(value)} options={spec.options ?? []} searchable={(spec.options?.length ?? 0) > 9} onChange={(v) => void set(v)} />
        ) : control === "textarea" ? (
          <textarea id={id} className="wb-input" rows={3} value={draft ?? String(value ?? "")} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== null && void set(draft)} />
        ) : (
          <>
            <input
              id={id}
              className="wb-input"
              type={control === "number" ? "number" : "text"}
              value={draft ?? String(value ?? "")}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft !== null && void set(control === "number" ? Number(draft) : draft)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
{spec.suggestions && (
              <Select aria-label={`Suggestions for ${spec.title}`} value="" placeholder="Suggestions" options={spec.suggestions.map((v) => ({ value: v, label: v }))} onChange={(v) => void set(control === "number" ? Number(v) : v)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const wb = useWerkbank();
  const shell = useDoc((doc) => doc.shell);
  const sections = [...new Set(["Appearance", ...wb.settings.sections()]), "Documentation"];
  const target = useMeta((meta) => meta.dialogSection);
  const [section, setSection] = useState(target && sections.includes(target.section) ? target.section : sections[0]!);
  const pages = documentation(wb);
  const [pageId, setPageId] = useState(target?.page && pages.some((p) => p.id === target.page) ? target.page : pages[0]!.id);
  const page = pages.find((p) => p.id === pageId) ?? pages[0]!;
  const showLogo = useSyncExternalStore(wb.settings.subscribe, () => wb.config.logo && wb.settings.get<boolean>("appearance.logo"));
  return (
    <Dialog title="Settings" onClose={onClose} wide>
      <div className="wb-settings">
        <nav className="wb-settings-nav" aria-label="Sections">
          {sections.map((name) => (
            <button key={name} className="wb-list-item" aria-current={section === name || undefined} onClick={() => setSection(name)}>
              {name}
            </button>
          ))}
        </nav>
        <div className="wb-settings-body">
          {section === "Documentation" ? (
            <div className="wb-docs">
              <div className="wb-docs-head">
                {showLogo && <img className="wb-docs-logo" src={wb.config.logo} alt="" />}
                <Select aria-label="Page" data-autofocus value={page.id} options={pages.map((p) => ({ value: p.id, label: p.title }))} onChange={setPageId} />
              </div>
              <Markdown text={page.text} />
            </div>
          ) : section === "Appearance" ? (
            <>
              {wb.settings.list().filter((s) => s.section === "Appearance").map((spec) => <SettingRow key={spec.key} spec={spec} />)}
              <div className="wb-setting">
                <div className="wb-setting-text">
                  <label htmlFor="setting-theme">Theme</label>
                </div>
                <div className="wb-setting-control">
                  <Select id="setting-theme" data-autofocus value={shell.theme} options={wb.themes.map((t) => ({ value: t, label: t }))} onChange={(theme) => void wb.run("view.theme", { theme })} />
                </div>
              </div>
              <div className="wb-setting">
                <div className="wb-setting-text">
                  <label htmlFor="setting-density">Density</label>
                  <p>Compact fits more on screen; comfortable gives rows and tabs more room.</p>
                </div>
                <div className="wb-setting-control">
                  <Select id="setting-density" value={shell.density} options={[{ value: "compact", label: "compact" }, { value: "comfortable", label: "comfortable" }]} onChange={(v) => v !== shell.density && void wb.run("view.density")} />
                </div>
              </div>
            </>
          ) : (
            wb.settings.list().filter((s) => s.section === section).map((spec) => <SettingRow key={spec.key} spec={spec} />)
          )}
          {section === "Assistant" && (
            <div className="wb-setting">
              <div className="wb-setting-text">
                <label>Connect an agent</label>
                <p>Choose the agent for the Assistant panel, or connect a coding agent of your own to this app.</p>
              </div>
              <div className="wb-setting-control">
                <button className="wb-button" onClick={() => wb.setMeta({ dialog: "assistant" })}>
                  Assistant setup…
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <footer className="wb-window-foot">
        {wb.config.title}
        {wb.config.version ? ` ${wb.config.version}` : ""} · built with Werkbank {FRAMEWORK_VERSION} · settings are stored in this browser
      </footer>
    </Dialog>
  );
}

// ---- assistant setup ------------------------------------------------------------

function AssistantSetupDialog({ onClose }: { onClose: () => void }) {
  const wb = useWerkbank();
  const bridge = useMeta((meta) => meta.bridge);
  const info = useMeta((meta) => meta.assistant);
  const setup = assistantSetup(wb, info);
  const [client, setClient] = useState(setup.connect[0]!.id);
  const chosen = setup.connect.find((c) => c.id === client)!;
  const agentSetting = useSyncExternalStore(wb.settings.subscribe, () => wb.settings.get<string>("assistant.agent"));
  const agentId = agentSetting || info?.defaultAgent || "";
  const agent = info?.agents.find((a) => a.id === agentId);
  const specs = Object.fromEntries(wb.settings.list().map((s) => [s.key, s]));
  const home = useMeta((meta) => meta.home);
  useSyncExternalStore(wb.conversations.subscribe, wb.conversations.list);
  const kept = wb.conversations.health();
  useSyncExternalStore(wb.files.subscribe, () => wb.files.health().onDisk);
  const files = wb.files.health();
  // A bridge left running from before an update, or (with bridges from before 0.7) one that another app started.
  const otherVersion = bridge === "connected" && info && info.version !== FRAMEWORK_VERSION ? info.version : null;

  return (
    <Dialog title="Assistant setup" onClose={onClose} wide>
      <div className="wb-setup">
        <p className="wb-setup-status" data-state={bridge}>
          <span className="wb-setup-dot" aria-hidden />
          {bridge === "connected"
            ? `Connected to the agent bridge${info ? ` (version ${info.version}) at ${info.mcp.url}` : ""}.`
            : bridge === "connecting"
              ? "Waiting for the agent bridge. Start it with `npm run dev` (app and bridge together) or `npm run bridge`."
              : "The connection to the agent bridge is switched off."}
        </p>
        {info?.foreign && (
          <p className="wb-setup-warning" role="status">
            This page is connected to another app's bridge: both apps were given the same port. Give this app a port of its own
            (<code>"werkbank": {"{"} "bridgePort": … {"}"}</code> in its package.json) and start it again. Until then it has no file
            store and no secrets, and agents may act on the wrong app.
          </p>
        )}
        {otherVersion && (
          <p className="wb-setup-warning" role="status">
            The bridge is version {otherVersion}; this app is built with Werkbank {FRAMEWORK_VERSION}, so parts of this window may not
            work. It is either left running from before an update (stop <code>npm run dev</code> and start it again) or it is another
            app's bridge on the same port (give this app its own: <code>"werkbank": {"{"} "bridgePort": … {"}"}</code> in its
            package.json).
          </p>
        )}

        <section>
          <h3>1. The assistant inside this app</h3>
          <p className="wb-hint">
            The Assistant panel hands each message to a coding agent installed on this machine. Choose which one. The model it uses is
            set in that agent's own configuration, not here.
          </p>
          <SettingRow spec={specs["assistant.connect"]!} />
          <div className="wb-setting">
            <div className="wb-setting-text">
              <label htmlFor="setup-agent">Agent</label>
              <p>{agent && !agent.available ? `${agent.label} was not found on this machine.` : "Only agents found on this machine can be chosen."}</p>
            </div>
            <div className="wb-setting-control">
              <Select
                id="setup-agent"
                data-autofocus
                value={agentId}
                disabled={!info}
                placeholder="not connected"
                options={(info?.agents ?? []).map((a) => ({ value: a.id, label: a.label, hint: a.available ? undefined : "not installed", disabled: !a.available }))}
                onChange={(value) => void wb.run("settings.set", { key: "assistant.agent", value })}
              />
            </div>
          </div>
        </section>

        <section>
          <h3>2. Your own coding agent</h3>
          <p className="wb-hint">
            Any agent that speaks MCP can read and drive this app: from a terminal session in a folder of your choice, alongside the
            panel above or instead of it. Register the app with the agent, then paste the briefing as your first message.
          </p>
          <div className="wb-segment" role="group" aria-label="Agent">
            {setup.connect.map((c) => (
              <button key={c.id} className="wb-button" aria-pressed={client === c.id} onClick={() => setClient(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <p className="wb-hint">{chosen.where}:</p>
          <div className="wb-code-row">
            <pre className="wb-code" aria-label={`${chosen.label} setup`}>{chosen.text}</pre>
            <CopyButton text={chosen.text} />
          </div>
          <p className="wb-hint">Briefing for the agent, written for this app:</p>
          <div className="wb-code-row">
            <textarea className="wb-code wb-setup-prompt" readOnly value={setup.prompt} aria-label="Briefing to paste into the agent" />
            <CopyButton text={setup.prompt} label="Copy briefing" />
          </div>
          <p className="wb-hint">
            What an agent does here is recorded in the action history as the agent's, can be undone, and anything irreversible waits for
            your approval in this window. The same connection lets other programs use this app's data.
          </p>
        </section>

        <section className="wb-setup-home">
          <h3>3. On this machine</h3>
          <p className="wb-hint">
            What belongs to this app but not in a browser is kept in the app's own folder, by the bridge: your conversations, and the
            secrets the app may use to reach other services.
          </p>
          <SettingRow spec={specs["storage.onDisk"]!} />
          <SettingRow spec={specs["assistant.conversationsOnDisk"]!} />
          <p className="wb-setup-line" data-state={files.onDisk ? "ok" : files.error ? "bad" : undefined}>
            <strong>Workspaces, settings, custom elements:</strong>{" "}
            {files.onDisk
              ? "kept in .werkbank/app-data.json in the app's folder, and in this browser."
              : files.error
                ? `kept in this browser only. Writing to the app's folder failed: ${files.error}`
                : "kept in this browser only."}
          </p>
          <p className="wb-setup-line" data-state={kept.onDisk ? "ok" : kept.diskError ? "bad" : undefined}>
            <strong>Conversations:</strong>{" "}
            {kept.onDisk
              ? "kept in .werkbank/conversations.json in the app's folder, and in this browser."
              : kept.diskError
                ? `kept in this browser only. Writing to the app's folder failed: ${kept.diskError}`
                : bridge !== "connected"
                  ? "kept in this browser only while the bridge is not connected."
                  : !home?.store
                    ? "kept in this browser only. This page did not reach the app's own bridge through its dev server."
                    : "kept in this browser only, as chosen above."}
          </p>
          <p className="wb-setup-line" data-state={home?.problems.length ? "bad" : home?.secrets.length ? "ok" : undefined}>
            <strong>Secrets:</strong>{" "}
            {!home?.available
              ? "none available. This page did not reach the app's own bridge through its dev server."
              : home.secrets.length
                ? `${home.secrets.length} in the app's .env file. The app uses them by name; their values stay with the bridge and are sent only to the hosts listed.`
                : "none in the app's .env file."}
          </p>
          {home?.secrets.length ? (
            <ul className="wb-setup-secrets">
              {home.secrets.map((secret) => (
                <li key={secret.name}>
                  <code>{secret.name}</code> for {secret.hosts.join(", ")}
                </li>
              ))}
            </ul>
          ) : null}
          {home?.problems.map((problem) => (
            <p key={problem} className="wb-setup-warning">
              {problem}
            </p>
          ))}
          {bridge === "connected" && !home?.available && (
            <p className="wb-hint">
              For both, the app's Vite config must use <code>bridgeProxy()</code> from <code>@werkbank/bridge/vite</code>, and the bridge
              must be the app's own, version 0.7 or newer.
            </p>
          )}
          {home?.available && (
            <p className="wb-hint">
              A secret is two lines in <code>.env</code>: <code>WERKBANK_SECRET_NAME=value</code> and{" "}
              <code>WERKBANK_SECRET_NAME_HOSTS=api.example.com</code>. The file must be readable by you alone (<code>chmod 600 .env</code>)
              and ignored by git.{" "}
              <button className="wb-linkish" onClick={() => void getAgentLink(wb)?.refreshHome()}>
                Check again
              </button>
            </p>
          )}
        </section>
      </div>
    </Dialog>
  );
}

/** Renders whichever app-level dialog is open. Mounted once by the shell. */
export function Dialogs() {
  const wb = useWerkbank();
  const dialog = useMeta((meta) => meta.dialog);
  const close = () => wb.setMeta({ dialog: null });
  if (dialog === "settings") return <SettingsDialog onClose={close} />;
  if (dialog === "assistant") return <AssistantSetupDialog onClose={close} />;
  return null;
}
