/** Built-in documents for the Document panel. Plain markdown. */
export const LIBRARY: Record<string, { title: string; text: string }> = {
  welcome: {
    title: "Welcome",
    text: `# Welcome to Werkbank

This app is a **dockable workspace**: every panel is a tab you can drag, split, stack, maximise or move to its own window.

## Five things to try

1. **Drag a tab** onto another panel's edge to split it, or onto its centre to stack it.
2. **Click a symbol** in the watchlist. Every panel in the same *link group* (the coloured dot on its tab) follows.
3. Press **Ctrl/⌘ K** and type a few letters of anything, for example \`preset\`.
4. Open the **Assistant** and ask it to *"show the symbol with the highest volatility"*.
5. Open **Workspaces** in the rail and switch between the presets.

## Presets

| Preset | What it shows |
| --- | --- |
| Trading desk | Live quotes, chart, portfolio, P&L, order entry |
| Analytics | Volatility surface, correlation, distributions, risk and return |
| Showcase | World map, CAD part, large grid, inspector, event log |
| Tasks | A list, a validated form and a board over the same records |

## Keyboard

| Keys | Action |
| --- | --- |
| Ctrl/⌘ K | Command palette |
| Ctrl Shift ← → ↑ ↓ | Focus the neighbouring panel |
| Ctrl Shift M | Maximise or restore |
| Ctrl Shift Enter | Zen mode |
| Ctrl/⌘ B | Side dock |

> All market data here is **simulated**. The symbols are invented and no order leaves the browser.
`,
  },
  note: {
    title: "Research note (sample)",
    text: `# Momentum after earnings: a first look

*Sample document. The numbers are placeholders that show how tables, lists and code render.*

## Question

Do prices keep drifting in the direction of an earnings surprise, and for how long?

## Method

- Universe: eight synthetic symbols, 250 trading days
- Signal: sign of the day-one return after the announcement
- Holding periods: 1, 5 and 20 days

\`\`\`python
def drift(returns, event_day, horizon):
    """Cumulative return from the day after the event."""
    window = returns[event_day + 1 : event_day + 1 + horizon]
    return (1 + window).prod() - 1
\`\`\`

## Results

| Horizon | Mean drift | t-stat | Observations |
| ---: | ---: | ---: | ---: |
| 1 day | 0.12% | 1.1 | 32 |
| 5 days | 0.41% | 1.8 | 32 |
| 20 days | 0.36% | 0.9 | 31 |

## Open points

- [x] Define the event window
- [ ] Control for the market factor
- [ ] Repeat on real data

## Caveats

1. Thirty-two events is a small sample.
2. No transaction costs.
3. ~~Survivorship bias~~ does not apply to synthetic symbols.
`,
  },
  blank: { title: "Scratch page", text: "# Scratch page\n\nWrite here. Switch to **Split** to see the result as you type.\n" },
};
