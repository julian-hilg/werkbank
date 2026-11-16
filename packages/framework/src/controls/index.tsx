import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * The framework's own choice controls. Nothing here uses the browser's or the
 * operating system's popups, so a dropdown looks the same in every browser,
 * theme and window:
 *
 *   Select       pick one of a list; `searchable` adds type-to-filter
 *   MultiSelect  pick several
 *   SearchBox    type to search, with an optional preview of the highlighted result
 *
 * All three keep the keyboard focus on their field while the list is open.
 */

export interface Option<V extends string = string> {
  value: V;
  label: string;
  /** Shown dimmed at the right of the row. */
  hint?: string;
  /** Rows with the same group sit under one heading. */
  group?: string;
  disabled?: boolean;
  /** Extra text a search matches, besides the label and hint. */
  keywords?: string;
}

// ---- the popup --------------------------------------------------------------------

/** A layer placed under (or, without room, above) its field, in the field's own window. */
function Popup({ anchor, className, children, onClose }: { anchor: RefObject<HTMLElement | null>; className?: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden", left: 0, top: 0 });
  const doc = anchor.current?.ownerDocument;

  useLayoutEffect(() => {
    const field = anchor.current;
    const view = field?.ownerDocument.defaultView;
    if (!field || !view) return;
    const place = () => {
      const box = field.getBoundingClientRect();
      const below = view.innerHeight - box.bottom - 8;
      const above = box.top - 8;
      const up = below < 160 && above > below;
      const width = ref.current?.offsetWidth ?? box.width;
      setStyle({
        left: Math.max(4, Math.min(box.left, view.innerWidth - width - 4)),
        ...(up ? { bottom: view.innerHeight - box.top + 2 } : { top: box.bottom + 2 }),
        minWidth: box.width,
        maxHeight: Math.max(96, Math.min(340, up ? above : below)),
      });
    };
    place();
    // Measured once more when the content has its real width.
    const again = view.requestAnimationFrame(place);
    const outside = (e: Event) => !ref.current?.contains(e.target as Node) && !field.contains(e.target as Node) && onClose();
    const scrolled = (e: Event) => (ref.current?.contains(e.target as Node) ? undefined : place());
    view.addEventListener("resize", place);
    view.addEventListener("scroll", scrolled, true);
    view.addEventListener("pointerdown", outside, true);
    return () => {
      view.cancelAnimationFrame(again);
      view.removeEventListener("resize", place);
      view.removeEventListener("scroll", scrolled, true);
      view.removeEventListener("pointerdown", outside, true);
    };
  }, [anchor, onClose]);

  if (!doc) return null;
  return createPortal(
    // Pressing inside must not take the focus from the field.
    <div ref={ref} className={`wb-popup ${className ?? ""}`} style={style} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>,
    doc.body,
  );
}

const matches = (o: Option, q: string) => !q || `${o.label} ${o.hint ?? ""} ${o.keywords ?? ""} ${o.group ?? ""}`.toLowerCase().includes(q);

/** The part of a label that matches the query, marked. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="wb-mark">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

function Rows<V extends string>({ id, options, active, selected, query, multiple, onHover, onChoose, empty }: {
  id: string;
  options: Option<V>[];
  active: number;
  selected: ReadonlySet<string>;
  query: string;
  multiple?: boolean;
  onHover: (index: number) => void;
  onChoose: (option: Option<V>) => void;
  empty: string;
}) {
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    list.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <ul ref={list} id={id} className="wb-listbox" role="listbox" aria-multiselectable={multiple || undefined}>
      {options.map((o, i) => (
        <li key={o.value} role="presentation">
          {o.group && o.group !== options[i - 1]?.group && <div className="wb-listbox-group">{o.group}</div>}
          <div
            id={`${id}-${i}`}
            role="option"
            className="wb-option"
            aria-selected={selected.has(o.value)}
            aria-disabled={o.disabled || undefined}
            data-active={i === active || undefined}
            data-value={o.value}
            onPointerMove={() => !o.disabled && i !== active && onHover(i)}
            onClick={() => !o.disabled && onChoose(o)}
          >
            <span className="wb-option-check" aria-hidden>
              {selected.has(o.value) ? "✓" : ""}
            </span>
            <span className="wb-option-label">
              <Highlight text={o.label} query={query} />
            </span>
            {o.hint && <span className="wb-option-hint">{o.hint}</span>}
          </div>
        </li>
      ))}
      {options.length === 0 && <li className="wb-listbox-empty">{empty}</li>}
    </ul>
  );
}

// ---- Select and MultiSelect ----------------------------------------------------------

interface FieldProps {
  id?: string;
  className?: string;
  title?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "data-autofocus"?: boolean;
  /** Type to filter the list. Worth it from about ten options. */
  searchable?: boolean;
}

function Picker<V extends string>({ options, selected, multiple, text, onChoose, searchable, placeholder, className, disabled, ...field }: FieldProps & {
  options: readonly Option<V>[];
  selected: ReadonlySet<string>;
  multiple?: boolean;
  /** What the closed field shows. */
  text: string;
  onChoose: (option: Option<V>) => void;
}) {
  const listId = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const typed = useRef({ text: "", at: 0 });
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => options.filter((o) => matches(o, q)), [options, q]);
  const at = Math.min(active, shown.length - 1);

  const close = useMemo(() => () => (setOpen(false), setQuery("")), []);
  const show = () => {
    if (disabled || open) return;
    setActive(Math.max(0, options.findIndex((o) => selected.has(o.value))));
    setOpen(true);
  };
  const step = (by: number) => {
    for (let i = at + by; i >= 0 && i < shown.length; i += by) if (!shown[i]!.disabled) return setActive(i);
  };
  const choose = (o: Option<V> | undefined) => {
    if (!o || o.disabled) return;
    onChoose(o);
    if (!multiple) close();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const isInput = e.currentTarget.tagName === "INPUT";
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || (e.key === " " && !isInput)) (e.preventDefault(), show());
      else if (!isInput && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        // Typing on a closed select jumps to the option that starts with what was typed.
        const now = Date.now();
        typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
        const hit = options.find((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
        if (hit && !multiple) onChoose(hit);
      }
      return;
    }
    if (e.key === "ArrowDown") (e.preventDefault(), step(1));
    else if (e.key === "ArrowUp") (e.preventDefault(), step(-1));
    else if (e.key === "Home" && !isInput) (e.preventDefault(), setActive(0));
    else if (e.key === "End" && !isInput) (e.preventDefault(), setActive(shown.length - 1));
    else if (e.key === "Enter" || (e.key === " " && !isInput)) (e.preventDefault(), choose(shown[at]));
    else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), close());
    else if (e.key === "Tab") close();
    else if (!isInput && e.key.length === 1) {
      const hit = shown.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (hit >= 0) setActive(hit);
    }
  };
  const common = {
    ...field,
    role: "combobox",
    "aria-haspopup": "listbox" as const,
    "aria-expanded": open,
    "aria-controls": open ? listId : undefined,
    "aria-activedescendant": open && shown[at] ? `${listId}-${at}` : undefined,
    "data-open": open || undefined,
    disabled,
    onKeyDown,
    onBlur: close,
  };
  return (
    <>
      {searchable ? (
        <input
          {...common}
          ref={anchor as RefObject<HTMLInputElement>}
          className={`wb-select ${className ?? ""}`}
          aria-autocomplete="list"
          spellCheck={false}
          autoComplete="off"
          value={open ? query : text}
          placeholder={open ? text || placeholder : placeholder}
          onChange={(e) => (show(), setQuery(e.target.value), setActive(0))}
          onClick={show}
        />
      ) : (
        <button {...common} ref={anchor as RefObject<HTMLButtonElement>} type="button" className={`wb-select ${className ?? ""}`} onClick={() => (open ? close() : show())}>
          <span className="wb-select-text" data-placeholder={text ? undefined : true}>
            {text || placeholder || " "}
          </span>
        </button>
      )}
      {open && (
        <Popup anchor={anchor} onClose={close}>
          <Rows id={listId} options={shown} active={at} selected={selected} query={searchable ? query.trim() : ""} multiple={multiple} onHover={setActive} onChoose={choose} empty="Nothing matches." />
        </Popup>
      )}
    </>
  );
}

/** Pick one value from a list. The app's replacement for a native `<select>`. */
export function Select<V extends string>({ value, options, onChange, ...field }: FieldProps & { value: V | "" | null | undefined; options: readonly Option<V>[]; onChange: (value: V) => void }) {
  const current = options.find((o) => o.value === value);
  return <Picker {...field} options={options} selected={new Set(current ? [current.value] : [])} text={current?.label ?? ""} onChoose={(o) => onChange(o.value)} />;
}

/** Pick any number of values. The list stays open while choosing. */
export function MultiSelect<V extends string>({ values, options, onChange, ...field }: FieldProps & { values: readonly V[]; options: readonly Option<V>[]; onChange: (values: V[]) => void }) {
  const chosen = options.filter((o) => values.includes(o.value));
  const text = chosen.length > 2 ? `${chosen.length} selected` : chosen.map((o) => o.label).join(", ");
  return (
    <Picker
      {...field}
      multiple
      options={options}
      selected={new Set(values)}
      text={text}
      // Kept in the order of the options, whatever the order of the clicks.
      onChoose={(o) => onChange(options.filter((x) => (x.value === o.value ? !values.includes(x.value) : values.includes(x.value))).map((x) => x.value))}
    />
  );
}

// ---- SearchBox --------------------------------------------------------------------------

export interface SearchItem {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  keywords?: string;
}

/**
 * A search field whose results open underneath it. With `preview`, the
 * highlighted result is shown beside the list before anything is chosen.
 * Give it `items` to filter, or `search` to fetch results for a query.
 */
export function SearchBox<T extends SearchItem>({ items, search, value = "", onPick, preview, renderItem, limit = 40, placeholder, className, ...field }: {
  items?: readonly T[];
  search?: (query: string) => T[] | Promise<T[]>;
  /** Shown in the field while it is not being used, e.g. the current choice. */
  value?: string;
  onPick: (item: T) => void;
  preview?: (item: T) => ReactNode;
  renderItem?: (item: T, query: string) => ReactNode;
  limit?: number;
  placeholder?: string;
  className?: string;
  id?: string;
  title?: string;
  "aria-label"?: string;
}) {
  const listId = useId();
  const anchor = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<{ query: string; items: T[] } | null>(null);
  const open = query !== null;
  const q = (query ?? "").trim();

  useEffect(() => {
    if (!open || !search) return;
    let current = true;
    void Promise.resolve(search(q)).then((result) => current && setFound({ query: q, items: result }));
    return () => void (current = false);
  }, [open, q, search]);

  const results = useMemo(() => {
    const all = search ? (found?.items ?? []) : (items ?? []).filter((item) => matches({ value: item.id, ...item }, q.toLowerCase()));
    return all.slice(0, limit);
  }, [search, found, items, q, limit]);
  const waiting = Boolean(search) && open && found?.query !== q;
  const at = Math.min(active, results.length - 1);
  const close = useMemo(() => () => setQuery(null), []);
  const pick = (item: T | undefined) => {
    if (item) onPick(item);
    close();
    anchor.current?.blur();
  };

  return (
    <>
      <input
        {...field}
        ref={anchor}
        className={`wb-input wb-search ${className ?? ""}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && results[at] ? `${listId}-${at}` : undefined}
        aria-autocomplete="list"
        spellCheck={false}
        autoComplete="off"
        value={query ?? value}
        placeholder={placeholder}
        onFocus={(e) => (setQuery(""), setActive(0), e.currentTarget.select())}
        onChange={(e) => (setQuery(e.target.value), setActive(0))}
        onBlur={close}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") (e.preventDefault(), setActive(Math.min(at + 1, results.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive(Math.max(at - 1, 0)));
          else if (e.key === "Enter") (e.preventDefault(), pick(results[at]));
          else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), pick(undefined));
        }}
      />
      {open && (
        <Popup anchor={anchor} className={preview ? "wb-search-popup" : undefined} onClose={close}>
          <ul id={listId} className="wb-listbox" role="listbox">
            {results.map((item, i) => (
              <li key={item.id} role="presentation">
                {item.group && item.group !== results[i - 1]?.group && <div className="wb-listbox-group">{item.group}</div>}
                <div id={`${listId}-${i}`} role="option" className="wb-option" aria-selected={i === at} data-active={i === at || undefined} data-value={item.id} onPointerMove={() => i !== at && setActive(i)} onClick={() => pick(item)}>
                  {renderItem ? (
                    renderItem(item, q)
                  ) : (
                    <>
                      <span className="wb-option-label">
                        <Highlight text={item.label} query={q} />
                      </span>
                      {item.hint && <span className="wb-option-hint">{item.hint}</span>}
                    </>
                  )}
                </div>
              </li>
            ))}
            {results.length === 0 && <li className="wb-listbox-empty">{waiting ? "Searching…" : q ? "Nothing matches." : "Type to search."}</li>}
          </ul>
          {preview && results[at] && (
            <div className="wb-search-preview" aria-live="polite">
              {preview(results[at]!)}
            </div>
          )}
        </Popup>
      )}
    </>
  );
}
