import { useEffect, useMemo, useRef, useState } from "react";
import { useWerkbank } from "../tools";

/** Every character of the query must appear in order; earlier and tighter matches rank higher. */
function score(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return direct;
  let at = -1;
  let cost = 100;
  for (const ch of q) {
    if (ch === " ") continue;
    const next = t.indexOf(ch, at + 1);
    if (next < 0) return null;
    cost += next - at;
    at = next;
  }
  return cost;
}

export function Palette({ initialQuery, onClose }: { initialQuery: string; onClose: () => void }) {
  const wb = useWerkbank();
  const [query, setQuery] = useState(initialQuery);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const entries = useMemo(() => wb.commands.palette(wb), [wb]);
  const matches = useMemo(
    () =>
      entries
        .map((entry) => ({ entry, rank: score(query.trim(), entry.title) }))
        .filter((m): m is { entry: (typeof entries)[number]; rank: number } => m.rank !== null)
        .sort((a, b) => a.rank - b.rank || a.entry.title.localeCompare(b.entry.title))
        .map((m) => m.entry),
    [entries, query],
  );
  const selected = Math.min(index, Math.max(matches.length - 1, 0));

  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const run = async (i: number) => {
    const entry = matches[i];
    if (!entry) return;
    const result = await wb.run(entry.commandId, entry.input);
    if (result.ok) onClose();
    else setError(result.error);
  };

  return (
    <div className="wb-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wb-palette" role="dialog" aria-label="Commands">
        <input
          className="wb-palette-input"
          autoFocus
          value={query}
          placeholder="Type a command"
          aria-label="Command"
          onChange={(e) => (setQuery(e.target.value), setIndex(0), setError(null))}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") (e.preventDefault(), setIndex(Math.min(selected + 1, matches.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setIndex(Math.max(selected - 1, 0)));
            else if (e.key === "Enter") void run(selected);
          }}
        />
        {error && <p className="wb-palette-error">{error}</p>}
        <ul className="wb-palette-list" role="listbox" ref={list}>
          {matches.map((entry, i) => (
            <li
              key={entry.key}
              role="option"
              aria-selected={i === selected}
              className="wb-palette-item"
              onPointerMove={() => setIndex(i)}
              onClick={() => void run(i)}
            >
              <span>{entry.title}</span>
              <span className="wb-palette-meta">{entry.keys ? entry.keys.replace("mod", "Ctrl/⌘") : entry.category}</span>
            </li>
          ))}
          {matches.length === 0 && <li className="wb-palette-none">No matching command.</li>}
        </ul>
      </div>
    </div>
  );
}
