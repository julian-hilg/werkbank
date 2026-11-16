import type { MouseEvent as ReactMouseEvent } from "react";
import type { Werkbank } from "./core";

/**
 * Right-click menus. Any component opens one with `openContextMenu`; the
 * shell renders it. Items are plain data, so a menu is easy to build from
 * commands. The menu also opens from the keyboard (the Menu key or Shift+F10
 * on a focused element), because those raise the same browser event.
 */
export type MenuItem =
  | { label: string; run: () => void; disabled?: boolean; checked?: boolean; hint?: string; danger?: boolean }
  | { separator: true }
  | { heading: string };

export interface OpenMenu {
  x: number;
  y: number;
  items: MenuItem[];
}

const openers = new WeakMap<Werkbank, (menu: OpenMenu) => void>();
/** The shell registers itself as the place menus are shown. */
export const setMenuOpener = (wb: Werkbank, opener: ((menu: OpenMenu) => void) | null): void => void (opener ? openers.set(wb, opener) : openers.delete(wb));

/** Call from an `onContextMenu` handler. Does nothing (and leaves the browser's own menu) if there is nothing to offer. */
export function openContextMenu(wb: Werkbank, event: ReactMouseEvent | MouseEvent, items: (MenuItem | false | null | undefined)[]): void {
  const list = items.filter(Boolean) as MenuItem[];
  if (!list.some((item) => "run" in item)) return;
  event.preventDefault();
  event.stopPropagation();
  // A keyboard-raised menu has no pointer position; anchor it to the element instead.
  const box = event.clientX === 0 && event.clientY === 0 ? (event.target as Element | null)?.getBoundingClientRect() : null;
  openers.get(wb)?.({ x: box ? box.left + 12 : event.clientX, y: box ? box.bottom : event.clientY, items: list });
}

/** Put text on the clipboard; used by "Copy" menu items. */
export const copyText = (text: string): void => void navigator.clipboard?.writeText(text).catch(() => {});
