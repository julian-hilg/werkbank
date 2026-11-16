import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Werkbank } from "../core";
import { setMenuOpener, type OpenMenu } from "../menu";

/** Renders the menu that `openContextMenu` asks for. One per app, mounted by the shell. */
export function ContextMenuHost({ wb }: { wb: Werkbank }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setMenuOpener(wb, (next) => (setPosition(null), setMenu(next)));
    return () => setMenuOpener(wb, null);
  }, [wb]);

  // Keep the menu on screen, then move focus into it.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    setPosition({ left: Math.max(4, Math.min(menu.x, window.innerWidth - box.width - 4)), top: Math.max(4, Math.min(menu.y, window.innerHeight - box.height - 4)) });
  }, [menu]);
  // Focus can only move in once the menu is visible, which is after it has been positioned.
  useLayoutEffect(() => {
    if (position) ref.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true]), [role=menuitemcheckbox]:not([aria-disabled=true])")?.focus();
  }, [position]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (e: Event) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), close());
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  if (!menu) return null;
  const move = (step: number) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not([aria-disabled=true])") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  };
  return (
    <ul
      ref={ref}
      className="wb-menu"
      role="menu"
      style={position ?? { left: menu.x, top: menu.y, visibility: "hidden" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setMenu(null);
        else if (e.key === "ArrowDown") (e.preventDefault(), move(1));
        else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
        e.stopPropagation();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) =>
        "separator" in item ? (
          <li key={i} role="separator" className="wb-menu-separator" />
        ) : "heading" in item ? (
          <li key={i} role="presentation" className="wb-menu-heading">
            {item.heading}
          </li>
        ) : (
          <li
            key={i}
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            tabIndex={-1}
            className="wb-menu-item"
            data-danger={item.danger || undefined}
            onClick={() => {
              if (item.disabled) return;
              setMenu(null);
              item.run();
            }}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), e.currentTarget.click())}
            onPointerEnter={(e) => !item.disabled && e.currentTarget.focus()}
          >
            <span className="wb-menu-check" aria-hidden>
              {item.checked ? "✓" : ""}
            </span>
            <span>{item.label}</span>
            {item.hint && <span className="wb-menu-hint">{item.hint}</span>}
          </li>
        ),
      )}
    </ul>
  );
}
