import type { Layout, LayoutNode, LayoutTab, LayoutTabset } from "./document";

/** Pure helpers over the layout tree. No DOM, no engine. */

export function tabsets(layout: Layout): LayoutTabset[] {
  const out: LayoutTabset[] = [];
  const walk = (node: LayoutNode) => {
    if (node.type === "tabset") out.push(node);
    else node.children.forEach(walk);
  };
  walk(layout.root);
  for (const f of layout.floating ?? []) out.push(f);
  return out;
}

export function tabIds(layout: Layout): string[] {
  return tabsets(layout).flatMap((t) => t.tabs.map((tab) => tab.id));
}

export function tabsetOf(layout: Layout, tabId: string): LayoutTabset | undefined {
  return tabsets(layout).find((t) => t.tabs.some((tab) => tab.id === tabId));
}

/** Remove tabs that fail `keep`, then drop tabsets and splits left empty. */
export function filterTabs(layout: Layout, keep: (tab: LayoutTab) => boolean): Layout {
  const prune = (node: LayoutNode): LayoutNode | null => {
    if (node.type === "tabset") {
      const tabs = node.tabs.filter(keep);
      if (tabs.length === 0) return null;
      const selectedId = tabs.some((t) => t.id === node.selectedId) ? node.selectedId : tabs[0]!.id;
      return { ...node, tabs, selectedId };
    }
    const children = node.children.map(prune).filter((c): c is LayoutNode => c !== null);
    if (children.length === 0) return null;
    if (children.length === 1) return { ...children[0]!, size: node.size };
    return { ...node, children };
  };
  const root = prune(layout.root) ?? { type: "tabset" as const, id: "root", tabs: [] };
  const floating = (layout.floating ?? [])
    .map((f) => ({ ...f, tabs: f.tabs.filter(keep) }))
    .filter((f) => f.tabs.length > 0);
  const ids = new Set(tabsets({ root, floating }).map((t) => t.id));
  return {
    root,
    ...(floating.length ? { floating } : {}),
    ...(layout.maximizedTabsetId && ids.has(layout.maximizedTabsetId)
      ? { maximizedTabsetId: layout.maximizedTabsetId }
      : {}),
  };
}

/**
 * Add tabs that live outside the main layout (popout windows) back into it,
 * so a stored document always contains every open panel.
 */
export function mergeTabs(layout: Layout, extra: LayoutTab[]): Layout {
  const present = new Set(tabIds(layout));
  const add = extra.filter((t) => !present.has(t.id));
  if (add.length === 0) return layout;
  let done = false;
  const walk = (node: LayoutNode): LayoutNode => {
    if (done) return node;
    if (node.type === "tabset") {
      done = true;
      return { ...node, tabs: [...node.tabs, ...add], selectedId: node.selectedId ?? add[0]!.id };
    }
    return { ...node, children: node.children.map(walk) };
  };
  return { ...layout, root: walk(layout.root) };
}

/** A compact, readable outline of the layout for agents and logs. */
export function outline(layout: Layout, title: (tabId: string) => string): unknown {
  const walk = (node: LayoutNode): unknown =>
    node.type === "tabset"
      ? { tabset: node.id, selected: node.selectedId, tabs: node.tabs.map((t) => `${t.id}: ${title(t.id)}`) }
      : { split: node.orientation, children: node.children.map(walk) };
  return {
    root: walk(layout.root),
    ...(layout.floating?.length ? { floating: layout.floating.map(walk) } : {}),
    ...(layout.maximizedTabsetId ? { maximized: layout.maximizedTabsetId } : {}),
  };
}

/**
 * How many tab groups hold a panel that wants a group to itself together with other panels.
 * A change to the layout must not raise this number; that is the whole rule.
 */
export function crowdedGroups(layout: Layout, alone: (tabId: string) => boolean): number {
  return tabsets(layout).filter((set) => set.tabs.length > 1 && set.tabs.some((tab) => alone(tab.id))).length;
}

/** Whether a panel may join a tab group: not if it wants a group to itself, and not if a panel there does. */
export function mayJoin(set: LayoutTabset | undefined, tabId: string, alone: (tabId: string) => boolean): boolean {
  const others = set?.tabs.filter((tab) => tab.id !== tabId) ?? [];
  return others.length === 0 || (!alone(tabId) && !others.some((tab) => alone(tab.id)));
}
