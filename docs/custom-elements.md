# Custom elements

How people build panels of their own inside an app, and how one of those
becomes part of the shared app.

## The problem this answers

When everyone has a coding agent, everyone builds tools. Unmanaged, that means
private scripts and dashboards with their own copies of data and credentials,
unreviewed and unknown to the people responsible for the systems. Banning
agents stops the building along with the risk.

The convention here keeps the building and bounds the risk. A person may build
any view they like, inside the app, on the app's data, in a place where it
cannot do harm; and there is a defined route from "mine" to "ours".

## The three states of an element

| State | Where it lives | Who sees it | How it is marked |
| --- | --- | --- | --- |
| **Custom** | The person's browser storage | Only that person | "(C)" after its name, under "Custom" in the tool list |
| **Submitted** | Same, plus a review package sent to the maintainers | Only that person, until merged | "(C)", status "submitted" |
| **Shipped** | The app's repository (`src/elements/`) | Everyone | No mark, under "Elements" |

Editing a submitted element makes it a draft again: what was reviewed is no
longer what runs.

## What a custom element can and cannot do

An element is one HTML document with inline script and style. It runs in a
frame with a unique origin and a content policy that blocks every request.

It **cannot**: make network requests (fetch, images, scripts, fonts, sockets),
reach the app's page, cookies or storage, run the app's commands (so it cannot
place an order or change a record), or see credentials.

It **can**, through the `werkbank` object:

- read which panels are open and the data behind them (what the app reports
  about each panel, the same data an agent sees);
- read and set shared context (the selected symbol, for example), validated by
  the app;
- keep its own small saved state;
- call the **host functions** the app chooses to offer. The starter offers one,
  `query`, which runs a read-only SQL statement on a tested data connection.

That last point is where an app decides how far personal elements may reach.
Host functions are declared in the app's configuration (`custom.hostFunctions`),
reviewed with the app, and should be read-only. An element needing more than
they offer is the signal to talk to the maintainers.

The checks in `scripts/check.mjs` run an element that tries each forbidden
thing and assert that all are blocked.

## Building one

Open the **Crafter** panel.

1. **New element**, then describe what it should show and press **Build with
   the assistant**. The request goes to the coding agent chosen in the
   assistant setup, with the element API as its briefing. The agent reads the
   shape of the data it needs from the running app and saves the element with
   the `custom.save` command, which is logged and undoable.
2. Look at the **Preview**. Ask for changes in the same box, or edit the
   **Source** by hand.
3. **Open as a panel** to use it in a workspace like any other tool.

## From custom to shipped

1. **Submit for review** in the Crafter. This produces a package
   (`<id>.element.json`): the source, who made it, the app and framework
   versions, and a scan of which API calls and host functions it uses. An app
   can deliver the package itself by setting `custom.submit` in its
   configuration (to open a ticket or a pull request); without that the file
   is downloaded for the person to send on. An agent cannot submit on its own:
   the command needs the person's approval.
2. A maintainer runs `npm run promote:element -- <file>`. It prints what the
   element uses, flags anything in the source that reaches outside the element
   API, and writes `src/elements/<id>.ts`.
3. The maintainer adds the export to `custom.elements` in the app's `app.ts`
   and opens a pull request. Review covers what a reviewer of any change would
   ask, plus: is the data it reads appropriate for everyone, and does it rely
   on a host function that should be narrower?
4. Once merged, the element ships to everyone, still in the sandbox. If it
   earns a permanent place, it can later be rewritten as a native tool with
   tests; the element is the specification.

## Private data and backends

Elements have no backend of their own, by design: a personal backend is
exactly the unmanaged system this convention exists to avoid. The route for
"I need data the app does not show" is:

- a **private data connection** (scope "private" in the Data connections
  panel), which the person sets up with their own credentials and which their
  elements can query read-only through the `query` host function; and
- if that is not enough, a request to the maintainers for a new host function
  or a new shared connection.

In the starter the database is simulated in the page. In a real app the
connection's driver and credentials live in the app's backend, and the host
function calls that backend. The boundary is the same either way: elements
reach data only through functions the app's maintainers wrote and reviewed.

## What this does not do yet

- There is no server-side storage for custom elements: they live in one
  browser. Sharing an unreviewed element with a colleague means sending the
  package file.
- The scan of an element's source is a text search, a starting point for a
  reviewer and not a proof.
- Submission delivery to a tracker is a hook the app must implement.

## Building an element from an agent

The builder is also part of the app's MCP surface, so any connected agent can build a panel, not only the Crafter:

1. `werkbank_element_guide` returns the element API, the app's host functions, the link topics, the open panels and the existing elements (pass `id` for one element's source).
2. `werkbank_save_element` saves the element and, with `open: true`, opens it as a panel. The save is recorded as the agent's and can be undone.

The prompt `build_element` wraps both steps, and `werkbank://elements` exposes the guide as a resource.

## Chart libraries

An element has no network access, so it cannot load a library from a CDN. The app supplies them instead:

```ts
import { chartLibraries } from "@werkbank/chart-libraries";
new Werkbank({ custom: { libraries: chartLibraries } });
```

An element then writes `<script src="lib:echarts"></script>` before its own script. The names are `echarts`, `d3`, `chartjs`, `lightweight-charts` and `plotly`; each is a separate chunk that is downloaded only when an element using it is opened. Any other `src` stays blocked. The starter's "Chart libraries" preset has one shipped element per library (`starter/src/elements/library-showcase.ts`) to copy from. Read colours from the `--wb-*` variables and redraw in `werkbank.onTheme`.

## Sharing an element

"Export" in the Crafter saves an element as an `.element.json` file; "Import from file" adds one. An import never overwrites an existing element, arrives as a draft, and runs in the same sandbox.
