import {
  Component,
  Suspense,
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import type { Instance, Meta, ToolSpec, Werkbank, WorkspaceDoc } from "../core";
import { Sandbox } from "./Sandbox";

/** A tool: its React-free spec plus the component that renders one panel. */
export interface ToolDefinition<S> extends ToolSpec<S> {
  component: ComponentType;
}

/** The one way to add a panel type. Keeps `S` inferred across all fields. */
export const defineTool = <S,>(tool: ToolDefinition<S>): ToolDefinition<S> => tool;

const WerkbankContext = createContext<Werkbank | null>(null);
const InstanceContext = createContext<string | null>(null);

export const WerkbankProvider = WerkbankContext.Provider;

export function useWerkbank(): Werkbank {
  const wb = useContext(WerkbankContext);
  if (!wb) throw new Error("useWerkbank must be used inside the Werkbank shell.");
  return wb;
}

/** Subscribe to part of the workspace document. Return existing references, not new objects. */
export function useDoc<T>(select: (doc: WorkspaceDoc) => T): T {
  const wb = useWerkbank();
  return useSyncExternalStore(wb.subscribeDoc, () => select(wb.getDoc()));
}

export function useMeta<T>(select: (meta: Meta) => T): T {
  const wb = useWerkbank();
  return useSyncExternalStore(wb.subscribeMeta, () => select(wb.getMeta()));
}

/** Id of the panel this component is rendered in. */
export function useInstanceId(): string {
  const id = useContext(InstanceContext);
  if (!id) throw new Error("This hook must be used inside a tool component.");
  return id;
}

export function useInstance(): Instance {
  const id = useInstanceId();
  return useDoc((doc) => doc.instances[id]!);
}

/** One app setting, and a function to change it (through the command registry, so it is logged and undoable). */
export function useSetting<T>(key: string): [T, (value: T) => void] {
  const wb = useWerkbank();
  const value = useSyncExternalStore(wb.settings.subscribe, () => wb.settings.get<T>(key));
  const set = useCallback((next: T) => void wb.run("settings.set", { key, value: next }), [wb, key]);
  return [value, set];
}

/** The panel's private, persisted state. */
export function useToolState<S>(): [S, (next: S | ((current: S) => S)) => void] {
  const wb = useWerkbank();
  const id = useInstanceId();
  const state = useDoc((doc) => doc.instances[id]?.state) as S;
  const set = useCallback(
    (next: S | ((current: S) => S)) => {
      const current = wb.getDoc().instances[id]?.state as S;
      wb.setState(id, typeof next === "function" ? (next as (c: S) => S)(current) : next);
    },
    [wb, id],
  );
  return [state, set];
}

/**
 * A shared context value such as the current symbol. Linked panels read and
 * write their group's value; independent panels keep their own.
 */
export function useLink<T>(topic: string): [T | undefined, (value: T) => void] {
  const wb = useWerkbank();
  const id = useInstanceId();
  const value = useDoc((doc) => {
    const inst = doc.instances[id];
    if (!inst) return undefined;
    return inst.link ? doc.links[inst.link]?.[topic] : inst.local[topic];
  }) as T | undefined;
  const publish = useCallback((next: T) => wb.publish(id, topic, next), [wb, id, topic]);
  return [value, publish];
}

class PanelBoundary extends Component<{ id: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="wb-panel-error" role="alert">
        <strong>This panel failed to render.</strong>
        <pre>{this.state.error.message}</pre>
        <button className="wb-button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

/** Renders one panel. A failure stays inside the panel that caused it. */
export function ToolHost({ id }: { id: string }) {
  const wb = useWerkbank();
  const toolId = useDoc((doc) => doc.instances[id]?.toolId);
  const theme = useDoc((doc) => doc.shell.theme);
  useMeta((meta) => meta.toolsVersion); // re-render when a custom element is saved
  if (!toolId) return null;
  const spec = wb.tools.get(toolId) as ToolDefinition<unknown> | undefined;
  // A custom element has no component of its own: its code runs in a sandbox.
  const element = spec?.element ? wb.elementOf(toolId) : undefined;
  const Tool = spec?.component;
  if (!element && !Tool) return null;
  return (
    <InstanceContext.Provider value={id}>
      <PanelBoundary id={id}>
        <div className="wb-tool" data-testid={`panel-${id}`} data-tool={toolId}>
          {/* A tool's component may be loaded on demand (React.lazy). */}
          <Suspense fallback={<p className="wb-hint wb-tool-loading">Loading…</p>}>
            {element ? <Sandbox wb={wb} element={element} instanceId={id} theme={theme} /> : Tool && <Tool />}
          </Suspense>
        </div>
      </PanelBoundary>
    </InstanceContext.Provider>
  );
}
