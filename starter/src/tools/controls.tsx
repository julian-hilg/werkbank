import { Markdown, MultiSelect, SearchBox, Select, defineTool, useLink, useToolState, useWerkbank } from "@werkbank/framework";
import { z } from "zod";
import { LIBRARY } from "../docs/library";
import { SECTORS, SYMBOLS, sectorOf, type SymbolId } from "../market/history";
import { OWNERS } from "../tasks/store";
import { SymbolPreview } from "./SymbolSearch";

/**
 * The framework's choice controls in one place: a plain dropdown, a searchable
 * one, a grouped one, a multi-select, and a search field that previews its
 * results. Every dropdown in the app is one of these; none is the browser's.
 */
const CURRENCIES: [string, string, string][] = [
  ["AUD", "Australian dollar", "Asia-Pacific"], ["CNY", "Chinese yuan", "Asia-Pacific"], ["HKD", "Hong Kong dollar", "Asia-Pacific"], ["INR", "Indian rupee", "Asia-Pacific"],
  ["JPY", "Japanese yen", "Asia-Pacific"], ["KRW", "South Korean won", "Asia-Pacific"], ["NZD", "New Zealand dollar", "Asia-Pacific"], ["SGD", "Singapore dollar", "Asia-Pacific"],
  ["CHF", "Swiss franc", "Europe"], ["CZK", "Czech koruna", "Europe"], ["DKK", "Danish krone", "Europe"], ["EUR", "Euro", "Europe"], ["GBP", "Pound sterling", "Europe"],
  ["HUF", "Hungarian forint", "Europe"], ["NOK", "Norwegian krone", "Europe"], ["PLN", "Polish zloty", "Europe"], ["SEK", "Swedish krona", "Europe"], ["TRY", "Turkish lira", "Europe"],
  ["BRL", "Brazilian real", "Americas"], ["CAD", "Canadian dollar", "Americas"], ["CLP", "Chilean peso", "Americas"], ["MXN", "Mexican peso", "Americas"], ["USD", "US dollar", "Americas"],
  ["AED", "UAE dirham", "Middle East and Africa"], ["ILS", "Israeli shekel", "Middle East and Africa"], ["SAR", "Saudi riyal", "Middle East and Africa"], ["ZAR", "South African rand", "Middle East and Africa"],
];
const CURRENCY_OPTIONS = CURRENCIES.map(([value, label, group]) => ({ value, label, hint: value, group }));

const stateSchema = z.object({
  owner: z.string(),
  currency: z.string(),
  sector: z.string(),
  symbols: z.array(z.string()),
  last: z.string().nullable(),
});
type State = z.infer<typeof stateSchema>;

type Found = { id: string; label: string; hint: string; group: string; keywords?: string } & ({ kind: "symbol"; symbol: SymbolId } | { kind: "document"; doc: string } | { kind: "panel"; toolId: string });

function Controls() {
  const wb = useWerkbank();
  const [state, setState] = useToolState<State>();
  const [, setSymbol] = useLink<SymbolId>("symbol");
  const everything: Found[] = [
    ...SYMBOLS.map((s): Found => ({ kind: "symbol", symbol: s, id: `s:${s}`, label: s, hint: sectorOf(s), group: "Symbols" })),
    ...Object.entries(LIBRARY).map(([doc, d]): Found => ({ kind: "document", doc, id: `d:${doc}`, label: d.title, hint: `${d.text.split(/\s+/).length} words`, group: "Documents", keywords: d.text.slice(0, 2000) })),
    ...[...wb.tools.values()].map((t): Found => ({ kind: "panel", toolId: t.id, id: `p:${t.id}`, label: t.title, hint: t.category ?? "", group: "Panels" })),
  ];
  const pick = (item: Found) => {
    setState({ ...state, last: `${item.group}: ${item.label}` });
    if (item.kind === "symbol") setSymbol(item.symbol);
    else if (item.kind === "document") void wb.run("panel.open", { toolId: "document", state: { doc: item.doc } });
    else void wb.run("panel.open", { toolId: item.toolId });
  };
  const row = (label: string, hint: string, control: React.ReactNode) => (
    <div className="wb-control">
      <label>{label}</label>
      {control}
      <span className="wb-control-label">{hint}</span>
    </div>
  );
  return (
    <div className="wb-form st-controls">
      {row(
        "Search with a preview",
        state.last ? `Last picked: ${state.last}.` : "Searches symbols, documents and panels. Arrow keys move, Enter picks: a symbol is selected for this link group, a document or panel opens.",
        <SearchBox
          aria-label="Search everything"
          placeholder="Search symbols, documents and panels"
          items={everything}
          onPick={pick}
          preview={(item) =>
            item.kind === "symbol" ? (
              <SymbolPreview symbol={item.symbol} />
            ) : item.kind === "document" ? (
              <Markdown text={`${LIBRARY[item.doc]!.text.slice(0, 420)}…`} />
            ) : (
              <>
                <h4>{item.label}</h4>
                <p className="wb-dim">{item.hint} panel</p>
                <p>Enter opens it in the active group.</p>
              </>
            )
          }
        />,
      )}
      <div className="wb-form-row">
        {row("Dropdown", "A short list: click, or type a first letter.", <Select aria-label="Owner" value={state.owner} options={OWNERS.map((o) => ({ value: o, label: o }))} onChange={(owner) => setState({ ...state, owner })} />)}
        {row("Dropdown with hints", "Each row can carry a second, quieter text.", <Select aria-label="Sector" value={state.sector} options={SECTORS.map((s) => ({ value: s, label: s, hint: `${SYMBOLS.filter((x) => sectorOf(x) === s).length} symbols` }))} onChange={(sector) => setState({ ...state, sector })} />)}
      </div>
      <div className="wb-form-row">
        {row("Searchable dropdown, grouped", "Type a name or a code, e.g. \"kr\" or \"franc\".", <Select aria-label="Currency" searchable value={state.currency} options={CURRENCY_OPTIONS} onChange={(currency) => setState({ ...state, currency })} />)}
        {row("Multi-select", "Stays open while you choose; searchable too.", <MultiSelect aria-label="Symbols" searchable placeholder="No symbols" values={state.symbols} options={SYMBOLS.map((s) => ({ value: s as string, label: s, hint: sectorOf(s) }))} onChange={(symbols) => setState({ ...state, symbols })} />)}
      </div>
    </div>
  );
}

export const controlsTool = defineTool<State>({
  id: "controls",
  title: "Controls",
  glyph: "▾",
  category: "Showcase",
  version: 1,
  stateSchema,
  defaultState: () => ({ owner: OWNERS[0]!, currency: "EUR", sector: SECTORS[0]!, symbols: ["ALFA", "DLTA"], last: null }),
  links: ["symbol"],
  component: Controls,
  describe: (state) => ({ note: "A showcase of the framework's Select, MultiSelect and SearchBox controls.", ...state }),
});
