/**
 * The only module that imports the layout library. It translates between our
 * layout tree and react-resizable-panels, and implements `LayoutEngine`.
 * Swapping the library means rewriting this file and nothing else.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import {
  Separator,
  Workspace,
  usePopoutWindows,
  useParentTabsetState,
  useWorkspaceRef,
  type TabNode,
  type TabRenderProps,
  type WorkspaceImperativeHandle,
  type WorkspaceModel,
  type WorkspaceModelInput,
  type WorkspaceNode,
} from "react-resizable-panels";
import {
  crowdedGroups,
  mayJoin,
  tabIds,
  tabsetOf,
  tabsets,
  type Direction,
  type DropTarget,
  type Layout,
  type LayoutEngine,
  type LayoutNode,
  type LayoutTab,
  type Werkbank,
} from "../core";

export type TabProps = TabRenderProps;

export interface DockAreaProps {
  wb: Werkbank;
  renderPanel: (instanceId: string) => ReactNode;
  renderTab: (instanceId: string, props: TabProps) => ReactNode;
  renderToolbar: (tabsetId: string) => ReactNode;
  renderEmpty: () => ReactNode;
}

/** Lets the shell start dragging a tool that is not open yet. */
export interface DockDrag {
  dragNew: (event: PointerEvent, title: string) => Promise<DropTarget | null>;
}

const toTab = (tab: LayoutTab): TabNode<null> => ({ id: tab.id, ...(tab.title ? { title: tab.title } : {}), data: null });

function toEngine(layout: Layout): WorkspaceModelInput<null> {
  const node = (n: LayoutNode): WorkspaceModelInput<null>["root"] =>
    n.type === "tabset"
      ? { type: "tabset", id: n.id, size: n.size, selectedId: n.selectedId, tabs: n.tabs.map(toTab) }
      : { type: "split", id: n.id, orientation: n.orientation, size: n.size, children: n.children.map(node) };
  return {
    version: 1,
    root: node(layout.root),
    ...(layout.floating?.length
      ? {
          floating: layout.floating.map((f) => ({
            type: "tabset" as const, id: f.id, selectedId: f.selectedId, tabs: f.tabs.map(toTab),
            x: f.x, y: f.y, width: f.width, height: f.height,
          })),
        }
      : {}),
    ...(layout.maximizedTabsetId ? { maximizedTabsetId: layout.maximizedTabsetId } : {}),
  };
}

function fromEngine(model: WorkspaceModel<null>): Layout {
  const tab = (t: TabNode<null>): LayoutTab => ({ id: t.id, ...(t.title ? { title: t.title } : {}) });
  const node = (n: WorkspaceNode<null>): LayoutNode =>
    n.type === "tabset"
      ? {
          type: "tabset", id: n.id, tabs: n.tabs.map(tab),
          ...(n.size !== undefined ? { size: n.size } : {}),
          ...(n.selectedId ? { selectedId: n.selectedId } : {}),
        }
      : {
          type: "split", id: n.id, orientation: n.orientation, children: n.children.map(node),
          ...(n.size !== undefined ? { size: n.size } : {}),
        };
  return {
    root: node(model.root),
    ...(model.floating?.length
      ? {
          floating: model.floating.map((f) => ({
            type: "tabset" as const, id: f.id, tabs: f.tabs.map(tab),
            ...(f.selectedId ? { selectedId: f.selectedId } : {}),
            x: f.x, y: f.y, width: f.width, height: f.height,
          })),
        }
      : {}),
    ...(model.maximizedTabsetId ? { maximizedTabsetId: model.maximizedTabsetId } : {}),
  };
}

const DRAG_GROUP = "werkbank";
const classNames = {
  tabset: "wb-tabset", header: "wb-tabset-header", tabList: "wb-tablist", tab: "wb-tab",
  toolbar: "wb-tabset-toolbar", tabPanels: "wb-panels", tabContent: "wb-panel",
  dropIndicator: "wb-drop", dragPreview: "wb-drag-preview",
};
const separator = () => <Separator className="wb-separator" />;

export function DockArea({ wb, renderPanel, renderTab, renderToolbar, renderEmpty, dragRef }: DockAreaProps & {
  dragRef?: { current: DockDrag | null };
}) {
  const ref = useWorkspaceRef<null>();
  const root = useRef<HTMLDivElement | null>(null);
  const [initial] = useState(() => toEngine(wb.getDoc().layout));
  const sync = useCallback(() => wb.syncLayout(), [wb]);

  const popouts = usePopoutWindows<null>({
    workspaceRef: ref,
    onClose: "dock",
    onOpen: (popout) => {
      const html = popout.window.document.documentElement;
      const main = document.documentElement;
      for (const name of ["data-theme", "data-density"]) html.setAttribute(name, main.getAttribute(name) ?? "");
      popout.window.document.title = wb.config.title;
      popout.window.document.body.className = "wb-popout-body";
      popout.container.className = "wb-popout";
    },
  });
  const popoutsRef = useRef(popouts);
  popoutsRef.current = popouts;
  const placed = useRef<string | undefined>(undefined);
  const popoutHandles = useRef(new Map<string, RefObject<WorkspaceImperativeHandle<null> | null>>());

  // Keep popout windows on the same theme and density as the main window.
  useEffect(
    () =>
      wb.subscribeDoc(() => {
        const { theme, density } = wb.getDoc().shell;
        for (const p of popoutsRef.current.popouts) {
          p.window.document.documentElement.setAttribute("data-theme", theme);
          p.window.document.documentElement.setAttribute("data-density", density);
        }
      }),
    [wb],
  );

  const engine = useMemo<LayoutEngine & DockDrag>(() => {
    const ws = () => {
      if (!ref.current) throw new Error("The layout is not mounted.");
      return ref.current;
    };
    const model = () => fromEngine(ws().getModel());
    const elements = () => [...(root.current?.querySelectorAll<HTMLElement>("[data-tabset]") ?? [])];
    const idOf = (el: HTMLElement) => el.getAttribute("data-tabset-id") ?? el.id;
    const alone = (tabId: string) => wb.keepsOwnGroup(tabId);
    const engineActive = () => (placed.current && ref.current ? tabsetOf(model(), placed.current)?.id : undefined) ?? ref.current?.getActiveTabsetId();
    const place = (tabId: string) => {
      placed.current = tabId;
    };
    const focus = (tabsetId: string) =>
      elements().find((e) => idOf(e) === tabsetId)?.querySelector<HTMLElement>("[data-tab-selected]")?.focus();
    return {
      snapshot: () => ({
        layout: model(),
        detached: popoutsRef.current.getState().flatMap((s) => tabsets(fromEngine(s.model)).flatMap((t) => t.tabs)),
      }),
      setLayout: (layout) => {
        placed.current = undefined;
        popoutsRef.current.closeAll();
        ws().setModel(toEngine(layout));
      },
      addTab: (tab, target) => {
        // A panel that keeps a group to itself goes beside the group it was aimed at, not into it; so does a panel aimed at such a group.
        const layout = model();
        const aimed = "tabsetId" in (target ?? {}) ? (target as { tabsetId: string; region?: string }) : undefined;
        const intoGroup = !target || (aimed && (aimed.region === undefined || aimed.region === "center"));
        const group = tabsets(layout).find((set) => set.id === (aimed?.tabsetId ?? engineActive())) ?? tabsets(layout).find((set) => set.tabs.length > 0);
        if (intoGroup && group && !mayJoin(group, tab.id, alone)) target = { tabsetId: group.id, region: "right" };
        const added = ws().addTab(toTab(tab), target ? { target } : undefined);
        if (added) place(tab.id);
        return added;
      },
      closeTab: (id) => {
        if (tabIds(model()).includes(id)) return ws().closeTab(id);
        // The tab lives in a popout window: close it there.
        for (const handle of popoutHandles.current.values()) {
          const popped = handle.current;
          if (popped && tabIds(fromEngine(popped.getModel())).includes(id)) popped.closeTab(id);
        }
      },
      selectTab: (id) => {
        if (tabIds(model()).includes(id)) {
          ws().selectTab(id);
          // Its group is now the active one: the next panel opens there.
          place(id);
          // Show where the person was taken: the tab lights up for a moment.
          requestAnimationFrame(() => {
            const tab = [...(root.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [])].find((el) => el.getAttribute("data-tab-id") === id);
            if (!tab) return;
            tab.removeAttribute("data-arrived");
            void tab.offsetWidth; // start the animation again if it is still running
            tab.setAttribute("data-arrived", "");
            setTimeout(() => tab.removeAttribute("data-arrived"), 1200);
          });
          return;
        }
        // The tab lives in a window of its own: bring that window forward.
        for (const p of popoutsRef.current.popouts) if ([...p.window.document.querySelectorAll("[data-tab-id]")].some((el) => el.getAttribute("data-tab-id") === id)) p.window.focus();
      },
      moveTab: (id, target) => {
        const aimed = "tabsetId" in target ? (target as { tabsetId: string; region?: string }) : undefined;
        const group = aimed && (aimed.region === undefined || aimed.region === "center") ? tabsets(model()).find((set) => set.id === aimed.tabsetId) : undefined;
        if (group && !mayJoin(group, id, alone)) target = { tabsetId: group.id, region: "right" };
        ws().moveTab(id, target);
        place(id);
      },
      retitle: (id, title) => ws().updateTab(id, { title }),
      toggleMaximize: (tabsetId) => {
        if (ws().getModel().maximizedTabsetId === tabsetId) ws().restoreTabset();
        else ws().maximizeTabset(tabsetId);
        // The tabset's element moves in the page, which drops keyboard focus; put it back.
        requestAnimationFrame(() => focus(tabsetId));
      },
      floatTab: (id) => ws().floatTab(id),
      popout: (id) => {
        const layout = model();
        const set = tabsetOf(layout, id);
        const tab = set?.tabs.find((t) => t.id === id);
        if (!set || !tab) return false;
        const index = set.tabs.indexOf(tab);
        ws().closeTab(id);
        const opened = popoutsRef.current.open(
          { version: 1, root: { type: "tabset", tabs: [toTab(tab)] } },
          { screenX: window.screenX + 80, screenY: window.screenY + 80, width: 760, height: 520 },
        );
        if (!opened) {
          // Blocked by the browser: put the tab back where it was.
          const still = tabsets(model()).some((t) => t.id === set.id);
          ws().addTab(toTab(tab), still ? { tabsetId: set.id, index } : undefined);
        }
        return opened;
      },
      activeTabsetId: () => {
        // The library only learns the active tabset from pointer and focus. A tab
        // placed by a command counts as active until the person interacts again.
        const viaCommand = placed.current && ref.current ? tabsetOf(model(), placed.current)?.id : undefined;
        return viaCommand ?? ref.current?.getActiveTabsetId();
      },
      neighbour: (tabsetId, direction) => nearest(elements(), idOf, tabsetId, direction),
      focusTabset: (tabsetId) => {
        placed.current = undefined;
        focus(tabsetId);
      },
      dragNew: async (event, title) => {
        const provisional = `new-${crypto.randomUUID()}`;
        const result = await ws().startExternalDrag(event, { tab: { id: provisional, title, data: null } });
        if (!result) return null;
        // The engine added a placeholder tab; the caller opens the real panel at the same place.
        const placed = tabsetOf(model(), provisional);
        const index = placed?.tabs.findIndex((t) => t.id === provisional) ?? 0;
        const alone = placed?.tabs.length === 1;
        ws().closeTab(provisional);
        if (!placed || alone) return result.target;
        return { tabsetId: placed.id, index };
      },
    };
  }, [ref]);

  // Any pointer or focus interaction hands "active" back to the library.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const clear = () => (placed.current = undefined);
    el.addEventListener("pointerdown", clear, true);
    el.addEventListener("focusin", clear, true);
    return () => {
      el.removeEventListener("pointerdown", clear, true);
      el.removeEventListener("focusin", clear, true);
    };
  }, []);

  useEffect(() => {
    wb.attachEngine(engine);
    if (dragRef) dragRef.current = engine;
    wb.syncLayout();
    return () => {
      wb.attachEngine(null);
      if (dragRef) dragRef.current = null;
    };
  }, [wb, engine, dragRef]);

  const shared = {
    classNames,
    dragGroup: DRAG_GROUP,
    disableDragBetweenApps: true,
    lazyTabContent: true,
    hiddenTabBehavior: "activity" as const,
    tabRemovalSelectionBehavior: "recent" as const,
    tabsetMinWidth: "120px",
    tabsetMinHeight: "60px",
    renderSeparator: separator,
    renderTabContent: useCallback((tab: TabNode<null>) => renderPanel(tab.id), [renderPanel]),
    renderTab: useCallback((tab: TabNode<null>, props: TabProps) => renderTab(tab.id, props), [renderTab]),
    renderTabsetToolbar: useCallback((set: { id: string }) => renderToolbar(set.id), [renderToolbar]),
    renderEmptyTabset: renderEmpty,
    renderDragPreview: useCallback((tab: TabNode<null>) => wb.titleOf(tab.id), [wb]),
    // Every close goes through the command registry, so it is logged and undoable.
    onBeforeModelChange: useCallback(
      ({ reason, removedTabs, model, prevModel }: { reason: string; removedTabs: TabNode<null>[]; model: Parameters<typeof fromEngine>[0]; prevModel: Parameters<typeof fromEngine>[0] }) => {
        if (reason === "close") {
          removedTabs.forEach((tab) => void wb.run("panel.close", { id: tab.id }));
          return false;
        }
        // A person's drag must not stack a panel that keeps a group to itself with another: such a drop is left undone.
        const alone = (tabId: string) => wb.keepsOwnGroup(tabId);
        return crowdedGroups(fromEngine(model), alone) <= crowdedGroups(fromEngine(prevModel), alone);
      },
      [wb],
    ),
  };

  return (
    <>
      <Workspace<null>
        {...shared}
        id="wb-main"
        className="wb-workspace"
        elementRef={root}
        workspaceRef={ref}
        defaultModel={initial}
        onModelChanged={sync}
      />
      {popouts.render((props, popout) => {
        popoutHandles.current.set(popout.id, props.workspaceRef);
        return (
        <Workspace<null>
          {...shared}
          {...props}
          className="wb-workspace"
          onModelChanged={(model, meta) => {
            props.onModelChanged(model, meta);
            sync();
          }}
        />
        );
      })}
    </>
  );
}

/** The tabset whose box lies closest in the given direction, by screen geometry. */
function nearest(
  elements: HTMLElement[],
  idOf: (el: HTMLElement) => string,
  fromId: string,
  direction: Direction,
): string | undefined {
  const from = elements.find((e) => idOf(e) === fromId)?.getBoundingClientRect();
  if (!from) return undefined;
  const horizontal = direction === "left" || direction === "right";
  let best: { id: string; score: number } | undefined;
  for (const el of elements) {
    const id = idOf(el);
    if (id === fromId) continue;
    const r = el.getBoundingClientRect();
    const gap =
      direction === "left" ? from.left - r.right
      : direction === "right" ? r.left - from.right
      : direction === "up" ? from.top - r.bottom
      : r.top - from.bottom;
    if (gap < -1) continue;
    const overlap = horizontal
      ? Math.min(from.bottom, r.bottom) - Math.max(from.top, r.top)
      : Math.min(from.right, r.right) - Math.max(from.left, r.left);
    if (overlap <= 0) continue;
    const score = gap * 10_000 - overlap;
    if (!best || score < best.score) best = { id, score };
  }
  return best?.id;
}

/** State of the tabset a toolbar is rendered in. */
export function useTabset(): { selectedTabId: string | undefined; isMaximized: boolean; isFloating: boolean } {
  const state = useParentTabsetState();
  return {
    selectedTabId: state?.selectedTabId,
    isMaximized: state?.isMaximized ?? false,
    isFloating: state?.isFloating ?? false,
  };
}
