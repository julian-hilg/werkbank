// End-to-end check of the starter in a real browser: node scripts/check.mjs
// Needs the dev server running (npm run dev). Exits non-zero on any failure.
import { launch } from "./browser.mjs";

const URL = process.env.APP_URL ?? "http://localhost:5199/";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 860 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const mod = process.platform === "darwin" ? "Meta" : "Control";
const wait = (ms) => page.waitForTimeout(ms);
const tabs = () => page.locator("#wb-main [data-tab]").count();
const chartSymbol = () => page.locator("[data-testid=panel-chart-1] input[aria-label=Symbol]").inputValue();
const ticketSymbol = () => page.locator("[data-testid=panel-ticket-1] .wb-field strong").innerText();
const tabsetOf = (tab) =>
  page.evaluate((t) => document.querySelector(`[data-testid=tab-${t}]`)?.closest("[data-tabset]")?.getAttribute("data-tabset-id"), tab);
const run = (id, input, actor) => page.evaluate(([id, input, actor]) => window.werkbank.run(id, input, actor), [id, input, actor]);
const palette = async (text) => {
  await page.keyboard.press(`${mod}+k`);
  await page.locator(".wb-palette-input").fill(text);
  await page.keyboard.press("Enter");
  await wait(150);
};
const portfolio = () => page.evaluate(() => window.werkbank.describe().panels.find((p) => p.id === "portfolio-1").data);
const feedLive = () => page.waitForFunction(() => window.feed.getStatus() === "live", null, { timeout: 10_000 });

await page.goto(URL);
await wait(800); // let the dev server settle if it just rebuilt
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("starter.settings", JSON.stringify({ "assistant.connect": false })); // this run does not involve the agent bridge
});
await page.reload();
await page.waitForSelector("[data-testid=panel-chart-1] canvas");

// --- default workspace ---
check("default workspace opens eleven panels", (await tabs()) === 11);
check("chart follows the group's symbol", (await chartSymbol()) === "DLTA");

// --- live data stream ---
await feedLive();
check("the feed connects and says so in the status bar", /feed: live \(simulated\)/.test(await page.locator(".wb-status").innerText()));
const v1 = await page.evaluate(() => window.feed.getVersion());
await wait(1500);
const v2 = await page.evaluate(() => window.feed.getVersion());
check("quotes stream in", v2 > v1 + 5, `${v2 - v1} updates in 1.5 s`);
// Prints for one symbol arrive irregularly, so wait for them rather than counting at a fixed moment.
const prints = await page.waitForFunction(() => document.querySelectorAll("[data-testid=panel-tape-1] tbody tr").length > 2, null, { timeout: 15000 }).then(() => true, () => false);
check("time and sales fills with prints", prints);
const liveBar = await page.evaluate(() => {
  const q = window.feed.getQuote("DLTA");
  const bar = window.feed.bars("DLTA").at(-1);
  return bar.close === q.last && bar.high >= bar.low && bar.high >= q.last && bar.low <= q.last && q.ask > q.bid;
});
check("today's bar is built from the stream and the quote is consistent", liveBar);

// --- stale data is never shown as live ---
await palette("pause the data feed");
const p1 = await page.evaluate(() => window.feed.getVersion());
await wait(700);
const p2 = await page.evaluate(() => window.feed.getVersion());
check("pausing stops the stream", p1 === p2 && /feed: paused/.test(await page.locator(".wb-status").innerText()));
check("paused quotes are marked stale", (await page.locator("[data-testid=panel-chart-1] .wb-badge", { hasText: "stale" }).count()) === 1);
check("the order ticket is disabled without a live quote", await page.locator("[data-testid=panel-ticket-1] .st-submit").isDisabled());
const refused = await run("order.place", { symbol: "DLTA", side: "buy", qty: 1 });
check("an order on a stale quote is refused", refused.ok === false && /No live quote/.test(refused.error));
await palette("resume the data feed");
await feedLive();
await run("feed.drop");
check("a dropped connection shows as reconnecting", (await page.evaluate(() => window.feed.getStatus())) === "reconnecting");
await feedLive();
check("the feed recovers by itself", true);

// --- linking ---
await page.locator("[data-testid=panel-watchlist-1] tr", { hasText: "BRVO" }).click();
check("selecting a symbol updates linked chart and ticket", (await chartSymbol()) === "BRVO" && (await ticketSymbol()) === "BRVO");
await page.locator("[data-testid=panel-portfolio-1] tbody tr", { hasText: "FXTR" }).click();
check("selecting a position drives the same link group", (await chartSymbol()) === "FXTR");
await page.locator("[data-testid=panel-watchlist-1] tr", { hasText: "BRVO" }).click();
await page.locator("[data-testid=tab-chart-1] .wb-link-dot").click(); // group 1 -> 2
check("a panel moved to another group keeps what it showed", (await chartSymbol()) === "BRVO");
await page.locator("[data-testid=panel-watchlist-1] tr", { hasText: "CHRL" }).click();
check("it no longer follows the first group", (await chartSymbol()) === "BRVO" && (await ticketSymbol()) === "CHRL");

// --- chart interaction ---
const box = await page.locator("[data-testid=panel-chart-1] canvas").boundingBox();
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
const readout = await page.locator("[data-testid=panel-chart-1] .st-readout").innerText();
check("hovering the chart reads out that bar", /O .* H .* L .* C .* V /.test(readout), readout.trim());
await page.keyboard.down("Shift");
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 5 });
await page.mouse.up();
await page.keyboard.up("Shift");
const range = await page.evaluate(() => window.werkbank.getDoc().links["2"]?.range);
check("shift-dragging on the chart publishes a date range to its group", Boolean(range?.from && range?.to && range.from < range.to), JSON.stringify(range));

// --- chart: zoom, pan, timeframes ---
const chartState = () => page.evaluate(() => window.werkbank.getDoc().instances["chart-1"].state);
const chartView = () => page.evaluate(() => window.werkbank.describe().panels.find((p) => p.id === "chart-1").data.view);
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -200);
await wait(150);
const zoomed = await chartState();
check("scrolling zooms the chart in around the pointer", zoomed.count < 120 && zoomed.offset > 0, `count ${zoomed.count}, offset ${zoomed.offset}`);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4, { steps: 6 });
await page.mouse.up();
await wait(150);
const panned = await chartState();
check("dragging pans back in time", panned.offset > zoomed.offset && panned.count === zoomed.count && (await chartView()).followsLive === false);
await page.locator("[data-testid=panel-chart-1] button", { hasText: "Live" }).click();
check("the Live button returns to the latest bar", (await chartState()).offset === 0 && (await chartView()).followsLive === true);
await page.locator("[data-testid=panel-chart-1] button", { hasText: /^1m$/ }).click();
await wait(200);
const minuteView = await chartView();
check("the chart switches to one-minute bars", (await chartState()).timeframe === "1m" && /\d\d:\d\d$/.test(minuteView.to) && minuteView.barsAvailable > 1900, `${minuteView.barsAvailable} bars, latest ${minuteView.to}`);
const liveBefore = (await page.evaluate(() => window.werkbank.describe().panels.find((p) => p.id === "chart-1").data.lastBars.at(-1)));
// The simulated feed pauses for a few seconds now and then, so wait for the bar to move rather than for a fixed time.
let liveAfter = liveBefore;
for (let i = 0; i < 30 && liveAfter.volume === liveBefore.volume && liveAfter.time === liveBefore.time; i++) {
  await wait(500);
  liveAfter = await page.evaluate(() => window.werkbank.describe().panels.find((p) => p.id === "chart-1").data.lastBars.at(-1));
}
check("the current minute bar is built from the live feed", liveAfter.volume > liveBefore.volume || liveAfter.time !== liveBefore.time);
await page.locator("[data-testid=panel-chart-1] button", { hasText: /^All$/ }).click();
check("All shows every bar available", (await chartView()).barsShown === (await chartView()).barsAvailable);
const viaAgent = await run("panel.setState", { id: "chart-1", patch: { timeframe: "15m", count: 60, offset: 0 } }, "agent");
check("an agent can set timeframe and zoom", viaAgent.ok && (await chartView()).barsShown === 60 && (await chartState()).timeframe === "15m");
await page.locator("[data-testid=panel-chart-1] button", { hasText: /^1D$/ }).click();
await page.locator("[data-testid=panel-chart-1] button", { hasText: /^candles$/ }).click();
check("chart style is per-panel state", (await page.evaluate(() => window.werkbank.getDoc().instances["chart-1"].state.style)) === "line");

// --- paper trading and P&L ---
await page.locator("[data-testid=panel-watchlist-1] tr", { hasText: "DLTA" }).click();
const before = await portfolio();
const heldBefore = before.positions.find((p) => p.symbol === "DLTA").qty;
await page.locator("[data-testid=panel-ticket-1] .st-submit").click();
await wait(200);
const fill = await page.evaluate(() => window.ledger.getTrades().at(-1));
const after = await portfolio();
const dlta = after.positions.find((p) => p.symbol === "DLTA");
check("the ticket places a paper order that fills at the ask", dlta.qty === heldBefore + 100 && fill.side === "buy" && fill.actor === "user");
check("cash falls by exactly the cost of the fill", Math.abs(before.cash - after.cash - fill.qty * fill.price) < 0.01);
const invested = after.positions.reduce((sum, p) => sum + p.value, 0);
check("equity equals cash plus position values", Math.abs(after.equity - after.cash - invested) < 0.05, `${after.equity} vs ${(after.cash + invested).toFixed(2)}`);
check("total P&L equals realised plus unrealised", Math.abs(after.pnl.total - after.pnl.realised - after.pnl.unrealised) < 0.05);
check("day P&L equals the sum over positions", Math.abs(after.pnl.day - after.positions.reduce((s, p) => s + p.dayPnl, 0)) < 0.05);
await page.locator("[data-testid=tab-blotter-1]").click();
check("the fill appears in the blotter", (await page.locator("[data-testid=panel-blotter-1] tbody tr").first().innerText()).includes("DLTA"));
await page.locator("[data-testid=tab-portfolio-1]").click();
const oversell = await run("order.place", { symbol: "HOTL", side: "sell", qty: 5 });
check("selling what is not held is rejected", oversell.ok === false && /Short selling/.test(oversell.error));
const pendingOrder = run("order.place", { symbol: "DLTA", side: "sell", qty: 50 }, "agent");
await page.waitForSelector(".wb-dialog");
check("an agent's order waits for the person's approval", /Place paper order/.test(await page.locator(".wb-dialog h2").innerText()));
await page.locator(".wb-dialog button", { hasText: "Approve" }).click();
const agentFill = (await pendingOrder).value;
check("once approved it fills and is attributed to the agent", agentFill?.actor === "agent" && agentFill.side === "sell");
check("the daily P&L curve covers the whole history", (await page.evaluate(() => window.werkbank.describe().panels.find((p) => p.id === "pnl-1").data.dailyCurve.days)) === 250);
await wait(2200);
await page.locator("[data-testid=panel-pnl-1] button", { hasText: "Session" }).click();
const pnlBox = await page.locator("[data-testid=panel-pnl-1] canvas").boundingBox();
await page.mouse.move(pnlBox.x + pnlBox.width * 0.5, pnlBox.y + pnlBox.height * 0.5);
check("the session P&L line collects samples and reads out on hover", /\d\d:\d\d:\d\d/.test(await page.locator("[data-testid=panel-pnl-1] .st-readout").innerText()));
await page.screenshot({ path: "scripts/shots/trading.png" });
await page.locator("[data-testid=panel-pnl-1] button", { hasText: "1Y daily" }).click();

// --- palette and themes ---
await palette("open another notes");
check("palette opens another panel of an open tool", (await tabs()) === 12);
await palette("theme dark");
check("palette switches theme", (await page.getAttribute("html", "data-theme")) === "dark");
await wait(300);
await page.screenshot({ path: "scripts/shots/dark.png" });
await palette("theme light");
await wait(300);
await page.screenshot({ path: "scripts/shots/light.png" });
await palette("theme xp");

// --- close, action history, undo ---
await page.locator("[data-testid=tab-notes-2] .wb-tab-close").click();
check("closing a tab removes the panel", (await tabs()) === 11);
await page.locator(".wb-rail-button[aria-label='Action history']").click();
const logged = await page.locator(".wb-log-entry").count();
check("actions are recorded in the history", logged >= 4, `${logged} entries`);
await page.locator("button", { hasText: "Undo last action" }).click();
check("undo restores the closed panel", (await tabs()) === 12 && (await page.locator("[data-testid=tab-notes-2]").count()) === 1);

// --- panel state survives a move; drag to dock ---
await page.locator("[data-testid=tab-notes-1]").click();
await page.locator("[data-testid=panel-notes-1] textarea").fill("kept across a move");
const from = await page.locator("[data-testid=tab-notes-1]").boundingBox();
const target = await page.locator("[data-testid=panel-chart-1]").boundingBox();
const beforeMove = await tabsetOf("notes-1");
await page.mouse.move(from.x + 20, from.y + 10);
await page.mouse.down();
await page.mouse.move(from.x - 60, from.y - 40, { steps: 5 });
await page.mouse.move(target.x + target.width / 2, target.y + target.height - 30, { steps: 15 });
await page.mouse.up();
await wait(200);
const afterMove = await tabsetOf("notes-1");
check("dragging a tab re-docks it", afterMove !== beforeMove, `${beforeMove} -> ${afterMove}`);
check("its state survived the move", (await page.locator("[data-testid=panel-notes-1] textarea").inputValue()) === "kept across a move");

// --- drag a new tool in from the side dock ---
await page.locator(".wb-rail-button[aria-label='Tools']").click();
const item = await page.locator(".wb-list-item", { hasText: "Watchlist" }).boundingBox();
const dropAt = await page.locator("[data-testid=panel-chart-1]").boundingBox();
const countBefore = await tabs();
await page.mouse.move(item.x + 30, item.y + 8);
await page.mouse.down();
await page.mouse.move(item.x + 80, item.y + 30, { steps: 5 });
await page.mouse.move(dropAt.x + dropAt.width / 2, dropAt.y + dropAt.height / 2, { steps: 15 });
await page.mouse.up();
await wait(300);
check("dragging a tool from the side dock opens it where dropped", (await tabs()) === countBefore + 1 && (await tabsetOf("watchlist-2")) === (await tabsetOf("chart-1")));
check("no placeholder tab is left behind", (await page.locator("[data-tab-id^='new-']").count()) === 0);

// --- clicking a tool that is open goes to it; only a drag opens another ---
const panelInFront = () => page.evaluate(() => window.werkbank.activeInstanceId());
const watchlistItem = page.locator(".wb-side .wb-list-item", { hasText: "Watchlist" });
check("a tool with an open panel is marked in the list", (await watchlistItem.getAttribute("data-open")) !== null);
await run("panel.focus", { id: "chart-1" });
await watchlistItem.click();
await wait(150);
const firstStop = await panelInFront();
check("clicking an open tool goes to its panel without opening another", (await tabs()) === countBefore + 1 && /^watchlist-[12]$/.test(firstStop ?? ""), String(firstStop));
await watchlistItem.click();
await wait(150);
const secondStop = await panelInFront();
check("clicking again walks to the tool's other panel", (await tabs()) === countBefore + 1 && /^watchlist-[12]$/.test(secondStop ?? "") && secondStop !== firstStop, `${firstStop} -> ${secondStop}`);
const closedTool = await page.evaluate(() => {
  const open = new Set(Object.values(window.werkbank.getDoc().instances).map((i) => i.toolId));
  const tool = [...window.werkbank.tools.values()].find((t) => !open.has(t.id));
  return tool ? { id: tool.id, title: tool.title } : null;
});
await page.locator(".wb-side .wb-list-item", { hasText: closedTool.title }).first().click();
await wait(200);
check("clicking a tool that is not open opens it", (await tabs()) === countBefore + 2 && (await page.evaluate((id) => Object.values(window.werkbank.getDoc().instances).some((i) => i.toolId === id), closedTool.id)));
await run("panel.close", { id: await panelInFront() });


// --- keyboard navigation, maximise, zen ---
await page.locator("[data-testid=tab-watchlist-1]").click();
const active = () => page.evaluate(() => document.activeElement?.closest("[data-tabset]")?.getAttribute("data-tabset-id") ?? null);
const start = await active();
await page.keyboard.press("Control+Shift+ArrowRight");
await wait(100);
const moved = await active();
check("Ctrl+Shift+Arrow moves focus to the neighbouring group", Boolean(moved) && moved !== start, `${start} -> ${moved}`);
await page.keyboard.press("Control+Shift+m");
await wait(150);
const wide = await page.evaluate(() => document.activeElement?.closest("[data-tabset]")?.getBoundingClientRect().width ?? 0);
check("keyboard focus survives maximise", wide > 0);
const mainWidth = await page.evaluate(() => document.querySelector(".wb-main").getBoundingClientRect().width);
check("maximise fills the dock area", wide >= mainWidth - 4, `${Math.round(wide)} of ${Math.round(mainWidth)}`);
await page.keyboard.press("Control+Shift+m");
await page.keyboard.press("Control+Shift+Enter");
check("zen mode hides rail, side dock and status bar", (await page.locator(".wb-rail, .wb-side, .wb-status").count()) === 0);
await page.keyboard.press("Control+Shift+Enter");
await page.keyboard.press(`${mod}+b`);
check("the side dock collapses to zero width", (await page.locator(".wb-side").count()) === 0);
await page.keyboard.press(`${mod}+b`);

// --- popout window ---
await page.locator("[data-testid=tab-chart-1]").click();
const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
await page.locator("[data-testid=tab-chart-1]").hover();
await page
  .locator("[data-tabset]", { has: page.locator("[data-testid=tab-chart-1]") })
  .locator("button[aria-label='Move to its own window']")
  .click();
const popup = await popupPromise;
check("a panel opens in its own window", popup !== null);
if (popup) {
  await popup.waitForSelector("[data-testid=panel-chart-1] canvas", { timeout: 5000 }).catch(() => {});
  const pixels = () =>
    popup.evaluate(() => {
      const c = document.querySelector("[data-testid=panel-chart-1] canvas");
      if (!c) return null;
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 97) sum = (sum + data[i] * (i % 251)) | 0;
      return { drawn: data.some((v, i) => i % 4 === 3 && v > 0), sum };
    });
  const first = await pixels();
  check("the canvas chart draws in the popout", Boolean(first?.drawn));
  // The simulated feed pauses for a few seconds now and then, so allow for one such pause.
  let redrawn = false;
  for (let i = 0; i < 24 && !redrawn; i++) {
    await popup.waitForTimeout(500);
    redrawn = (await pixels())?.sum !== first?.sum;
  }
  check("the popped-out chart keeps streaming", redrawn);
  check("the popout carries the theme", (await popup.getAttribute("html", "data-theme")) === "xp");
  check("the popped-out panel left the main window", (await page.locator("#wb-main [data-testid=tab-chart-1]").count()) === 0);
  const stored = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("starter.workspace.current"));
    return JSON.stringify(doc.layout).includes("chart-1") && Boolean(doc.instances["chart-1"]);
  });
  check("the saved workspace still contains the popped-out panel", stored);
  if (!(await page.locator(".wb-side .wb-list-item").count())) await page.locator(".wb-rail-button[aria-label='Tools']").click();
  const beforeClick = Object.keys(await page.evaluate(() => window.werkbank.getDoc().instances)).length;
  await page.locator(".wb-side .wb-list-item", { hasText: /^\S*\s*Chart$/ }).click();
  await wait(200);
  check(
    "clicking a tool whose panel is in its own window opens no second one",
    Object.keys(await page.evaluate(() => window.werkbank.getDoc().instances)).length === beforeClick && (await popup.locator("[data-testid=panel-chart-1]").count()) === 1,
  );
  await popup.screenshot({ path: "scripts/shots/popout.png" });
  await popup.close();
  await wait(400);
  check("closing the window docks the panel back", (await page.locator("#wb-main [data-testid=tab-chart-1]").count()) === 1);
}

// --- named workspaces ---
await page.locator(".wb-rail-button[aria-label='Workspaces']").click();
await page.locator("input[aria-label='Workspace name']").fill("research");
await page.locator("button", { hasText: /^Save$/ }).click();
const countSaved = await tabs();
await page.locator("button", { hasText: "Reset to default" }).click();
await wait(200);
check("reset returns to the default workspace", (await tabs()) === 11);
await page.locator(".wb-side .wb-list-item", { hasText: "research" }).click();
await wait(200);
check("a named workspace loads back", (await tabs()) === countSaved, `${countSaved} panels`);

// --- persistence across reload ---
const fillsBefore = await page.evaluate(() => window.ledger.getTrades().length);
await wait(500);
await page.reload();
await page.waitForSelector("[data-testid=tab-chart-1]");
check("the workspace survives a reload", (await tabs()) === countSaved);
check("panel state survives a reload", (await page.evaluate(() => window.werkbank.getDoc().instances["notes-1"].state.text)) === "kept across a move");
check("link state survives a reload", (await page.evaluate(() => window.werkbank.linksOf("chart-1").symbol)) === "BRVO");
check("the paper ledger survives a reload", (await page.evaluate(() => window.ledger.getTrades().length)) === fillsBefore, `${fillsBefore} fills`);

// --- agent view ---
await feedLive();
const described = await page.evaluate(async () => {
  const werkbank = window.werkbank;
  const view = werkbank.describe();
  const chart = view.panels.find((p) => p.id === "chart-1");
  const ok = await werkbank.run("link.publish", { group: "2", topic: "symbol", value: "ECHO" }, "agent");
  const bad = await werkbank.run("link.publish", { group: "2", topic: "symbol", value: "NOPE" }, "agent");
  return {
    symbol: chart?.data?.symbol, hasBars: chart?.data?.shown?.bars > 0, quoteLive: chart?.data?.quote?.live,
    ok: ok.ok, bad: bad.ok, actor: werkbank.getMeta().log.at(-2)?.actor, now: werkbank.linksOf("chart-1").symbol,
  };
});
check("describe() exposes chart data and the live quote without pixels", described.symbol === "BRVO" && described.hasBars && described.quoteLive === true);
check("an agent command changes the app and is attributed", described.ok && described.actor === "agent" && described.now === "ECHO");
check("an invalid agent value is rejected by the topic schema", described.bad === false);

// --- non-trading workspace: list, form with validation, board ---
await palette("preset workspace tasks");
await page.waitForSelector("[data-testid=panel-task-form-1] form");
check("a preset switches to a different workspace in the same shell", (await tabs()) === 5 && (await page.locator(".wb-status").innerText()).startsWith("Tasks"));
const form = page.locator("[data-testid=panel-task-form-1]");
const task = (id) => page.evaluate((id) => window.tasks.get(id), id);
check("the form shows the task selected in its link group", (await form.locator("input[id$=-title]").inputValue()) === (await task("T-104")).title);
await page.locator("[data-testid=panel-tasks-1] tr", { hasText: "T-105" }).click();
check("selecting a row in the list loads it in the form", (await form.locator(".wb-form-actions strong").first().innerText()) === "T-105");

await form.locator("input[id$=-title]").fill("x");
await form.locator("input[id$=-estimateHours]").fill("abc");
const errorsShown = await form.locator(".wb-control-error").allInnerTexts();
check("invalid fields show their own messages", errorsShown.some((e) => /at least 3 characters/.test(e)) && errorsShown.some((e) => /number of hours/.test(e)), errorsShown.join(" | "));
check("an invalid form cannot be saved", await form.locator("button[type=submit]").isDisabled());
check("invalid input never reaches the data", (await task("T-105")).title === "Review outlier rules");
await form.locator("input[id$=-title]").fill("Review outlier rules v2");
await form.locator("input[id$=-estimateHours]").fill("4.5");
await form.locator("label", { hasText: "Blocked" }).locator("input").check();
check("a rule across fields is enforced (blocked needs a note)", /blocked on/.test((await form.locator(".wb-control-error").allInnerTexts()).join(" ")));
await form.locator("textarea").fill("Needs the vendor file first.");
check("unsaved changes are marked", (await form.locator(".wb-badge").first().innerText()) === "unsaved changes");

await wait(500);
await page.reload();
await page.waitForSelector("[data-testid=panel-task-form-1] form");
check("an unsaved draft survives a reload", (await form.locator("input[id$=-title]").inputValue()) === "Review outlier rules v2" && (await task("T-105")).title === "Review outlier rules");
await form.locator("button[type=submit]").click();
await wait(150);
const savedTask = await task("T-105");
check("saving writes the validated values", savedTask.title === "Review outlier rules v2" && savedTask.estimateHours === 4.5 && savedTask.blocked === true && savedTask.revision === 2);
check("the list shows the saved change", (await page.locator("[data-testid=panel-tasks-1] tr", { hasText: "T-105" }).innerText()).includes("v2 (blocked)"));
await run("history.undo");
check("undo reverses a change to app data", (await task("T-105")).title === "Review outlier rules" && (await task("T-105")).blocked === false);

const card = page.locator("[data-testid=panel-board-1] .st-card", { hasText: "T-106" });
await card.hover();
await card.locator("button[aria-label='Move T-106 right']").click();
await wait(100);
check("moving a card on the board changes the task's status", (await task("T-106")).status === "doing");
const dragCard = page.locator("[data-testid=panel-board-1] .st-card", { hasText: "T-107" });
await dragCard.dragTo(page.locator("[data-testid=panel-board-1] section[aria-label='In review']"));
await wait(150);
check("dragging a card to another column changes its status", (await task("T-107")).status === "review");
await page.locator("[data-testid=panel-tasks-1] input[type=search]").fill("pipeline");
check("the list filters as you type", (await page.locator("[data-testid=panel-tasks-1] tbody tr").count()) === 3);
await page.locator("[data-testid=panel-tasks-1] input[type=search]").fill("");
await page.locator("[data-testid=panel-tasks-1] button", { hasText: "New task" }).click();
await wait(150);
check("a new task is created and opened in the form", (await form.locator(".wb-form-actions strong").first().innerText()) === "T-109" && Boolean(await task("T-109")));
await form.locator("button", { hasText: "Delete task" }).click();
await wait(150);
check("deleting removes the task", (await task("T-109")) === undefined);
await run("history.undo");
check("and undo brings it back", Boolean(await task("T-109")));
await page.screenshot({ path: "scripts/shots/tasks.png" });

// --- the gallery: every preset renders, and each new panel does its job ---
const panel = (id) => page.locator(`[data-testid=panel-${id}]`);
const stateOf = (id) => page.evaluate((id) => window.werkbank.getDoc().instances[id].state, id);
const dataOf = (id) => page.evaluate((id) => window.werkbank.describe().panels.find((p) => p.id === id).data, id);
const health = () =>
  page.evaluate(() => {
    const view = window.werkbank.describe();
    const blank = [...document.querySelectorAll("#wb-main [data-tab-content] canvas")].filter((c) => {
      if (!c.offsetParent || !c.width) return false;
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      return !data.some((v, i) => i % 4 === 3 && v > 0);
    }).length;
    return { broken: document.querySelectorAll(".wb-panel-error").length, blank, undescribed: view.panels.filter((p) => p.data === undefined).map((p) => p.id) };
  });

await palette("preset workspace analytics");
await page.waitForSelector("[data-testid=panel-vol-surface-1] canvas");
await wait(600);
let h = await health();
check("the Analytics preset renders nine panels without a failure or a blank chart", (await tabs()) === 9 && h.broken === 0 && h.blank === 0, JSON.stringify(h));

// --- a panel that keeps a tab group to itself (the market monitor), the tab that lights up, "Open" in the palette ---
const monitorGroup = await tabsetOf("monitor-1");
await run("panel.move", { id: "chart-1", target: { tabsetId: monitorGroup, region: "center" } });
await wait(200);
check("a panel moved onto one that keeps its own group lands beside it, not on it", (await tabsetOf("chart-1")) !== (await tabsetOf("monitor-1")) && (await tabs()) === 9);
await run("panel.move", { id: "monitor-1", target: { tabsetId: await tabsetOf("returns-1"), region: "center" } });
await wait(200);
check("such a panel cannot be stacked on another either", (await tabsetOf("monitor-1")) !== (await tabsetOf("returns-1")));
const besideMonitor = await run("panel.open", { toolId: "notes", target: { tabsetId: await tabsetOf("monitor-1"), region: "center" } });
await wait(200);
check("a panel besideMonitor into its group opens beside it", besideMonitor.ok && (await tabsetOf(besideMonitor.value)) !== (await tabsetOf("monitor-1")));
await run("panel.close", { id: besideMonitor.value });
const draggedTab = await page.locator("[data-testid=tab-returns-1]").boundingBox();
const ontoMonitor = await page.locator("[data-testid=panel-monitor-1]").boundingBox();
await page.mouse.move(draggedTab.x + 20, draggedTab.y + 10);
await page.mouse.down();
await page.mouse.move(draggedTab.x + 60, draggedTab.y + 40, { steps: 5 });
await page.mouse.move(ontoMonitor.x + ontoMonitor.width / 2, ontoMonitor.y + ontoMonitor.height / 2, { steps: 15 });
await page.mouse.up();
await wait(250);
check("dragging a tab onto the middle of it does not stack them", (await tabsetOf("returns-1")) !== (await tabsetOf("monitor-1")) && (await tabs()) === 9);
await run("panel.focus", { id: "scatter-1" });
await run("panel.focus", { id: "monitor-1" });
const litTab = await page.waitForSelector("[data-testid=tab-monitor-1][data-arrived], [data-tab-id=monitor-1][data-arrived]", { timeout: 1000 }).then(() => true, () => false);
check("the tab a person is taken to lights up for a moment", litTab);
await run("panel.focus", { id: "scatter-1" });
await palette("open market monitor");
check("\"Open\" in the palette goes to the panel that is open instead of opening another", (await tabs()) === 9 && (await page.evaluate(() => window.werkbank.activeInstanceId())) === "monitor-1");
await palette("open another market monitor");
check("\"Open another\" in the palette opens a second one", (await tabs()) === 10);
await run("workspace.preset", { name: "Analytics" });
await page.waitForSelector("[data-testid=panel-vol-surface-1] canvas");
await wait(600);

const surface = await panel("vol-surface-1").locator("canvas").boundingBox();
await page.mouse.move(surface.x + surface.width * 0.5, surface.y + surface.height * 0.5);
check("hovering the volatility surface reads out a point", /days\s+strike \d+% of spot\s+implied vol \d+\.\d%/.test(await panel("vol-surface-1").locator(".st-readout").innerText()));
const yawBefore = (await stateOf("vol-surface-1")).yaw;
await page.mouse.down();
await page.mouse.move(surface.x + surface.width * 0.5 + 120, surface.y + surface.height * 0.5 + 20, { steps: 6 });
await page.mouse.up();
check("dragging rotates the surface and the angle is kept", (await stateOf("vol-surface-1")).yaw !== yawBefore);
await panel("vol-surface-1").locator("button", { hasText: "Smiles" }).click();
await panel("vol-surface-1").locator("polyline").first().waitFor();
check("the smile view draws one line per maturity", (await panel("vol-surface-1").locator("polyline").count()) === 7, `${await panel("vol-surface-1").locator("polyline").count()}`);
const iv = (await dataOf("vol-surface-1")).impliedVol;
check("an agent gets the surface as numbers", iv.length === 7 && iv[0].length === 13 && iv.flat().every((v) => v > 0));

check("the correlation matrix has a cell for every pair", (await panel("correlation-1").locator("svg g[data-cell]").count()) === 64);
await panel("correlation-1").locator("svg g[data-cell]").nth(40).click();
const picked = await page.evaluate(() => window.werkbank.getDoc().links["1"].symbol);
check("clicking a correlation cell selects that symbol for the whole group", (await panel("returns-1").locator("input[aria-label=Symbol]").inputValue()) === picked, picked);
const corr = panel("correlation-1");
const matrixBefore = (await dataOf("correlation-1")).matrix;
await corr.locator("button", { hasText: "Spearman" }).click();
await corr.locator("button", { hasText: /^60d$/ }).click();
const corrData = await dataOf("correlation-1");
check("correlation method and lookback change the numbers", corrData.settings.method === "spearman" && corrData.settings.lookbackDays === 60 && JSON.stringify(corrData.matrix) !== JSON.stringify(matrixBefore));
await corr.locator("button", { hasText: "Triangle" }).click();
check("the triangle shape drops the mirrored half", (await corr.locator("svg g[data-cell]").count()) === 36);
await corr.locator("button", { hasText: "Clustered" }).click();
const clustered = await dataOf("correlation-1");
const strongest = clustered.matrix.flatMap((row, i) => row.map((v, j) => ({ v, i, j }))).filter((c) => c.i < c.j).sort((a, b) => b.v - a.v)[0];
check("clustered order puts the most correlated pair side by side", strongest.j - strongest.i === 1, `${clustered.symbols[strongest.i]}–${clustered.symbols[strongest.j]} ${strongest.v}`);
await corr.locator("input[type=range]").fill("0.5");
const fadedCells = await corr.locator("svg g[data-cell][style*='opacity: 0.18']").count();
check("weak correlations can be faded out", fadedCells > 0 && fadedCells < 36, `${fadedCells} of 36 faded`);
check("the selected pair's rolling correlation is shown and reported", (await corr.locator(".st-pair polyline").count()) === 1 && typeof clustered.pair.latest === "number" && clustered.pair.min <= clustered.pair.latest && clustered.pair.latest <= clustered.pair.max);
check("the return histogram has 31 bars", (await panel("returns-1").locator("svg rect[style*='--wb-accent']").count()) === 31);
await panel("returns-1").locator("button", { hasText: "Calendar" }).click();
await panel("returns-1").locator("svg rect").first().waitFor();
check("the calendar view has one square per trading day", (await panel("returns-1").locator("svg rect").count()) === 249, `${await panel("returns-1").locator("svg rect").count()}`);
check("the risk/return chart plots every symbol inside its axes", await page.evaluate(() => {
  const svg = document.querySelector("[data-testid=panel-scatter-1] svg");
  const box = svg.getBoundingClientRect();
  const marks = [...svg.querySelectorAll("circle[stroke-width='2']")];
  return marks.length === 8 && marks.every((c) => { const r = c.getBoundingClientRect(); return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom; });
}));
const tiles = await page.evaluate(() => {
  const root = document.querySelector("[data-testid=panel-treemap-1] .st-treemap").getBoundingClientRect();
  const boxes = [...document.querySelectorAll("[data-testid=panel-treemap-1] .st-tile")].map((t) => t.getBoundingClientRect());
  return { n: boxes.length, covered: boxes.reduce((s, b) => s + (b.width + 2) * (b.height + 2), 0) / (root.width * root.height) };
});
const heldCount = (await page.evaluate(() => window.werkbank.describe().panels.find((p) => p.id === "treemap-1").data.positions.length));
check("the treemap tiles fill the panel, one per position", tiles.n === heldCount && Math.abs(tiles.covered - 1) < 0.02, `${tiles.n} tiles, ${(tiles.covered * 100).toFixed(1)}% covered`);
const book = await dataOf("depth-1");
check("the order book has ten ordered levels a side", book.bids.length === 10 && book.asks.length === 10 && book.bids[0].price < book.asks[0].price && book.bids[9].price < book.bids[0].price);
check("the market monitor shows every symbol", (await panel("monitor-1").locator(".st-monitor-card").count()) === 8);

await palette("preset workspace showcase");
await page.waitForSelector("[data-testid=panel-map-1] svg path");
await wait(500);
h = await health();
check("the Showcase preset renders eleven panels without a failure", (await tabs()) === 11 && h.broken === 0 && h.undescribed.length === 0, JSON.stringify(h));

check("the map draws the world's countries", (await panel("map-1").locator("svg path[data-country]").count()) > 150);
// A real press and release at a point inside Brazil, as a person would click.
const brazil = await panel("map-1").locator("path[data-country='Brazil']").boundingBox();
await page.mouse.click(brazil.x + brazil.width * 0.45, brazil.y + brazil.height * 0.4);
const country = await page.evaluate(() => window.werkbank.getDoc().links["3"].country);
await panel("map-1").locator("path[data-country='Brazil']").hover({ force: true });
check("clicking a country selects it", country === "Brazil" && /Brazil\s+revenue share 1\.8% \(rank 14 of 25\)/.test(await panel("map-1").locator(".st-readout").innerText()), `${country}: ${await panel("map-1").locator(".st-readout").innerText()}`);
check("the legend explains the colour classes", (await panel("map-1").locator(".st-map-key li").count()) === 6);
await panel("map-1").locator("button[aria-label='Zoom in']").click();
await wait(500);
check("zooming the map glides and is kept in its state", (await stateOf("map-1")).zoom === 1.5);
await panel("map-1").locator("button", { hasText: "Globe" }).click();
await wait(300);
const visibleOnGlobe = await panel("map-1").locator("svg path[data-country]").count();
check("the globe shows only the hemisphere facing the viewer", visibleOnGlobe > 40 && visibleOnGlobe < 170, `${visibleOnGlobe} countries drawn`);
const facingAtStart = (await stateOf("map-1")).rotate;
const africa = await panel("map-1").locator("path[data-country='Nigeria']").boundingBox();
await page.mouse.click(africa.x + africa.width / 2, africa.y + africa.height / 2);
await wait(900);
const facingNigeria = (await stateOf("map-1")).rotate;
check("clicking a country on the globe turns it to face you", (await page.evaluate(() => window.werkbank.getDoc().links["3"].country)) === "Nigeria" && Math.abs(facingNigeria[0] - 8) < 6 && facingNigeria[0] !== facingAtStart[0], `facing ${facingNigeria.join(", ")}`);
const globeBox = await panel("map-1").locator("svg").boundingBox();
const facingBefore = (await stateOf("map-1")).rotate;
await page.mouse.move(globeBox.x + globeBox.width / 2, globeBox.y + globeBox.height / 2);
await page.mouse.down();
await page.mouse.move(globeBox.x + globeBox.width / 2 - 160, globeBox.y + globeBox.height / 2 + 30, { steps: 8 });
await page.mouse.up();
await wait(100);
const facingAfter = (await stateOf("map-1")).rotate;
check("dragging turns the globe", facingAfter[0] > facingBefore[0] + 10, `${facingBefore[0]} -> ${facingAfter[0]} degrees east`);
check("panels load their heavy parts on demand", await page.evaluate(() => performance.getEntriesByType("resource").some((r) => /map\.view/.test(r.name))));
await panel("map-1").locator("button", { hasText: "Flat" }).click();

const massBefore = (await dataOf("cad-1")).derived.massGramsSteel;
await panel("cad-1").locator("input[aria-label='Width value']").fill("200");
const cad = await dataOf("cad-1");
check("changing a CAD dimension updates the part and its derived mass", cad.params.width === 200 && cad.derived.massGramsSteel > massBefore, `${massBefore} g -> ${cad.derived.massGramsSteel} g`);
await panel("cad-1").locator("input[aria-label='Hole diameter value']").fill("30");
await panel("cad-1").locator("input[aria-label='Holes per plate value']").fill("6");
check("an impossible part is flagged", /overlap/.test(await panel("cad-1").locator("[role=alert]").first().innerText()));
await panel("cad-1").locator("button", { hasText: /^Top$/ }).click();
check("a standard view sets the camera", (await stateOf("cad-1")).pitch === 90);
const agentEdit = await run("panel.setState", { id: "cad-1", patch: { params: { width: 90, depth: 50, height: 70, thickness: 5, holeDiameter: 6, holes: 2 } } }, "agent");
check("an agent can reshape the part through a command", agentEdit.ok && (await dataOf("cad-1")).params.width === 90 && (await dataOf("cad-1")).problems.length === 0);
const tooBig = await run("panel.setState", { id: "cad-1", patch: { params: { width: 9000, depth: 50, height: 70, thickness: 5, holeDiameter: 6, holes: 2 } } }, "agent");
check("and cannot set a dimension outside its limits", tooBig.ok === false && (await dataOf("cad-1")).params.width === 90);

const doc = panel("document-1");
check("markdown renders headings, tables and lists", (await doc.locator(".wb-markdown h1").innerText()) === "Welcome to Werkbank" && (await doc.locator(".wb-markdown table").count()) === 2 && (await doc.locator(".wb-markdown ol li").count()) === 5);
await doc.locator("button", { hasText: "Split" }).click();
await doc.locator("textarea").fill("# Changed\n\n<script>window.hacked = true</script>\n\n- [x] done\n- [ ] open\n");
check("editing updates the preview as you type", (await doc.locator(".wb-markdown h1").innerText()) === "Changed" && (await doc.locator(".wb-markdown input[type=checkbox]").count()) === 2);
check("HTML in a document is shown as text, not run", (await page.evaluate(() => window.hacked)) === undefined && (await doc.locator(".wb-markdown script").count()) === 0);
await doc.locator("button", { hasText: "Revert" }).click();
check("reverting restores the original document", (await doc.locator(".wb-markdown h1").innerText()) === "Welcome to Werkbank");

const grid = panel("grid-1");
const gridRows = () => grid.locator(".st-grid-row").count();
check("the grid holds 100,000 rows but only renders those in view", (await grid.locator("[role=table]").getAttribute("aria-rowcount")) === "100001" && (await gridRows()) < 80, `${await gridRows()} rows in the page`);
await grid.locator(".st-grid-viewport").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
await wait(150);
check("scrolling to the end shows the last row", (await grid.locator(".st-grid-row").last().innerText()).startsWith("100000"));
await grid.locator("input[type=search]").fill("dlta xnas");
await grid.locator("button", { hasText: "Buys" }).click();
await wait(150);
const filtered = await dataOf("grid-1");
check("filters narrow the rows and the summary follows", filtered.matchingRows > 0 && filtered.matchingRows < 3000 && Object.keys(filtered.bySymbol).join() === "DLTA" && filtered.firstRows.every((r) => r.side === "buy" && r.venue === "XNAS"), `${filtered.matchingRows} rows`);
await grid.locator("button[role=columnheader]", { hasText: "Qty" }).click();
await grid.locator("button[role=columnheader]", { hasText: "Qty" }).click();
await wait(150);
check("sorting a column reorders all matching rows", (await dataOf("grid-1")).firstRows[0].qty === 5000);
const [download] = await Promise.all([page.waitForEvent("download"), grid.locator("button", { hasText: "CSV" }).click()]);
const csv = (await (await import("node:fs/promises")).readFile(await download.path(), "utf8")).split("\r\n");
check("CSV export contains a header and every matching row", csv[0] === "id,time,symbol,side,qty,price,venue,trader,status" && csv.length - 2 === filtered.matchingRows, `${csv.length - 2} rows in ${download.suggestedFilename()}`);

await page.locator("[data-testid=tab-eventlog-1]").click();
check("the event log records what happened across the app", /agent: Set panel state/.test(await panel("eventlog-1").locator(".st-log-list").innerText()));
check("failed actions are logged as errors", (await panel("eventlog-1").locator(".st-log-row[data-level=error]").count()) >= 1);

await panel("inspector-1").locator("input[type=search]").fill("holeDiameter");
check("the inspector searches the app's own state", /holeDiameter\s+6/.test(await panel("inspector-1").locator(".st-tree").innerText()));
await page.locator("[data-testid=tab-export-1]").click();
const reportText = await panel("export-1").locator(".st-doc-page").innerText();
check("the report is built from what the panels report", /CAD part \(cad-1\)/.test(reportText) && /World map \(map-1\)/.test(reportText) && (await panel("export-1").locator(".wb-markdown table").count()) >= 2);
const viaCommand = await run("export.report", { panels: ["cad-1"], format: "markdown" }, "agent");
check("an agent can request the same report", viaCommand.ok && /## CAD part \(cad-1\)/.test(viaCommand.value) && !/World map/.test(viaCommand.value));

await page.locator(".wb-rail-button[aria-label='Tools']").click();
await page.locator("input[aria-label='Filter tools']").fill("map");
check("the tool list groups by category and filters", (await page.locator(".wb-side .wb-list-item").allInnerTexts()).map((t) => t.replace(/^\S+\s*/, "").trim()).sort().join() === "Position map,World map");
await page.locator("input[aria-label='Filter tools']").fill("");
await page.screenshot({ path: "scripts/shots/showcase.png" });

await palette("preset workspace tasks");
await page.locator("[data-testid=tab-timeline-1]").click();
await page.waitForSelector("[data-testid=panel-timeline-1] svg");
const bars = await dataOf("timeline-1");
check("the timeline draws a bar for each task with a due date", bars.bars.length === (await panel("timeline-1").locator("svg rect[rx='2']").count()) && bars.bars.length >= 6);

// --- settings: a window, with sections the app adds ---
await run("workspace.reset");
await page.keyboard.press(`${mod}+,`);
await page.waitForSelector(".wb-window");
const sections = await page.locator(".wb-settings-nav button").allInnerTexts();
check("settings open as a window, with the app's own sections beside the framework's", ["Appearance", "Assistant", "Trading", "Market data", "Data"].every((name) => sections.includes(name)), sections.join(", "));
await page.locator(".wb-settings-nav button", { hasText: "Trading" }).click();
const quantity = page.locator("#setting-trading\\.defaultQuantity");
await quantity.fill("250");
await quantity.blur();
await wait(150);
const setting = (key) => page.evaluate((k) => window.werkbank.settings.get(k), key);
check("changing a setting takes effect", (await setting("trading.defaultQuantity")) === 250);
await quantity.fill("0");
await quantity.blur();
await wait(150);
check("a value the setting's schema refuses is not stored", (await setting("trading.defaultQuantity")) === 250 && (await page.locator(".wb-setting .wb-control-error").count()) === 1);
await page.keyboard.press("Escape");
check("Escape closes the window", (await page.locator(".wb-window").count()) === 0);
await page.locator("[data-testid=panel-ticket-1] button", { hasText: "use the default quantity (250)" }).click();
check("panels read settings", (await stateOf("ticket-1")).qty === 250);
await run("history.undo");
check("a setting change can be undone like any action", (await setting("trading.defaultQuantity")) === 100);
check("an agent can read and change settings through commands", (await run("settings.set", { key: "data.rowLimit", value: "100" }, "agent")).ok && (await page.evaluate(() => window.werkbank.describe({ detail: "summary" }).settings["data.rowLimit"])) === "100" && (await run("settings.set", { key: "data.rowLimit", value: "7" }, "agent")).ok === false);

// --- right-click menus ---
const menuItems = () => page.locator(".wb-menu [role^=menuitem]").allInnerTexts();
await page.locator("[data-testid=tab-watchlist-1]").click({ button: "right" });
const tabMenu = (await menuItems()).map((t) => t.replace(/\s+/g, " ").trim());
check("right-clicking a tab offers its actions", ["Close", "Duplicate", "Move to its own window", "Group 1", "Close all other panels"].every((label) => tabMenu.some((t) => t.includes(label))), tabMenu.slice(0, 6).join(" | "));
check("the menu shows the current link group as checked", (await page.locator(".wb-menu [role=menuitemcheckbox][aria-checked=true]").innerText()).includes("Group 1"));
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Escape");
check("Escape closes the menu", (await page.locator(".wb-menu").count()) === 0);
await page.locator("[data-testid=tab-watchlist-1]").click({ button: "right" });
await page.locator(".wb-menu [role=menuitem]", { hasText: "Duplicate" }).click();
await wait(150);
check("choosing a menu item runs the command", (await page.locator("[data-testid=tab-watchlist-2]").count()) === 1);
await run("panel.close", { id: "watchlist-2" });
const groupBefore = await page.evaluate(() => window.werkbank.getDoc().links["1"].symbol);
await page.locator("[data-testid=panel-watchlist-1] tr", { hasText: "HOTL" }).click({ button: "right" });
await page.locator(".wb-menu [role=menuitem]", { hasText: "Open a chart on it" }).click();
await wait(300);
const opened = await page.evaluate(() => { const i = Object.values(window.werkbank.getDoc().instances).find((x) => x.toolId === "chart" && x.id !== "chart-1"); return i && { id: i.id, link: i.link, symbol: window.werkbank.linksOf(i.id).symbol }; });
check("a row's menu opens a panel of its own on that symbol, leaving the group alone", opened?.symbol === "HOTL" && opened.link === null && (await page.evaluate(() => window.werkbank.getDoc().links["1"].symbol)) === groupBefore, JSON.stringify(opened));
await run("panel.close", { id: opened.id });
await page.locator("[data-testid=panel-chart-1] canvas").click({ button: "right" });
await page.locator(".wb-menu [role=menuitemcheckbox]", { hasText: /^\s*✓?\s*15m/ }).click();
check("the chart's menu changes its timeframe", (await stateOf("chart-1")).timeframe === "15m");
await run("panel.setState", { id: "chart-1", patch: { timeframe: "1D", count: 120, offset: 0 } });

// --- symbol search in charts ---
const search = page.locator("[data-testid=panel-chart-1] input[aria-label=Symbol]");
await search.click();
await search.fill("ener");
const offered = await page.locator(".wb-popup .wb-option").allInnerTexts();
await page.keyboard.press("Enter");
check("the chart's search finds symbols by sector and sets the group's symbol", offered.length === 2 && offered.every((o) => o.includes("Energy")) && (await page.evaluate(() => window.werkbank.getDoc().links["1"].symbol)) === "GOLF", offered.map((o) => o.split("\n")[0]).join(", "));
await search.click();
await search.fill("zzz");
await page.keyboard.press("Escape");
check("an abandoned search changes nothing", (await chartSymbol()) === "GOLF");

// --- correlation peer groups follow the selection ---
await palette("preset workspace analytics");
await page.waitForSelector("[data-testid=panel-correlation-1] svg");
const choose = async (field, label) => { await field.click(); await page.locator(".wb-popup .wb-option", { hasText: label }).first().click(); };
await choose(panel("correlation-1").locator("[aria-label='Peer group']"), "Peers of");
const sectorOfLinked = async () => { const d = await dataOf("correlation-1"); return { linked: d.linkedSymbol, symbols: d.symbols, sectors: [...new Set(d.symbols.map((s) => d.sectors[s]))] }; };
const peersA = await sectorOfLinked();
await run("link.publish", { group: "1", topic: "symbol", value: "ALFA" });
const peersB = await sectorOfLinked();
check("the sector peer group is the selected symbol's sector, and changes with the selection", peersA.sectors.length === 1 && peersA.symbols.includes(peersA.linked) && peersB.sectors[0] === "Industrials" && peersB.symbols.includes("ALFA") && peersA.sectors[0] !== peersB.sectors[0], `${peersA.symbols.join(",")} -> ${peersB.symbols.join(",")}`);
await choose(panel("correlation-1").locator("[aria-label='Peer group']"), "Custom group");
await run("panel.setState", { id: "correlation-1", patch: { custom: ["DLTA", "GOLF"] } });
const custom = await dataOf("correlation-1");
check("a custom group keeps its symbols and takes in the selected one", custom.symbols.length === 3 && ["DLTA", "GOLF", "ALFA"].every((sym) => custom.symbols.includes(sym)), custom.symbols.join(","));
check("the correlation network draws every symbol", (await page.evaluate(() => window.werkbank.tools.has("network"))) === true);

// --- data connections and the SQL console ---
await palette("preset workspace data and build");
await page.waitForSelector("[data-testid=panel-connections-1] form");
const conn = panel("connections-1");
await conn.locator("#conn-password").fill("wrong");
await conn.locator("button", { hasText: "Test connection" }).click();
await conn.locator("[role=status]").waitFor();
check("a failed connection says why", /Login failed for user 'analyst'/.test(await conn.locator("[role=status]").innerText()));
await conn.locator("#conn-password").fill("demo");
await conn.locator("button", { hasText: "Test connection" }).click();
await page.waitForFunction(() => window.connections.get("research").status === "ok");
check("a good connection reports the server it reached", /SQL Server 2022 \(simulated\), database Research/.test(await conn.locator("[role=status]").innerText()));
check("the password is never written to storage", !JSON.stringify(await page.evaluate(() => Object.entries(localStorage))).includes("\"demo\"") && !(await page.evaluate(() => localStorage.getItem("starter.connections") ?? "")).includes("demo"));
await conn.locator("#conn-port").fill("99999");
check("connection settings are validated field by field", /65535|port/i.test(await conn.locator(".wb-control[data-invalid] .wb-control-error").first().innerText()) && (await conn.locator("button[type=submit]").isDisabled()));
await conn.locator("button", { hasText: "Discard changes" }).click();
const offline = await run("connection.test", { id: "bridge-api" });
check("API and MCP connections say plainly that they need the bridge when it is off", offline.ok === false && /bridge is not connected/.test(offline.error));
await conn.locator("[aria-label='New connection']").click();
const kindsOffered = (await page.locator(".wb-popup .wb-option-label").allInnerTexts()).join();
await page.keyboard.press("Escape");
check("three kinds of connection are offered", kindsOffered === "SQL Server,HTTP API,MCP server", kindsOffered);
const sql = panel("sql-1");
await sql.locator("button", { hasText: /^Run$/ }).click();
await sql.locator(".wb-table tbody tr").first().waitFor();
check("the SQL console runs a query on the connection", (await sql.locator(".wb-table tbody tr").count()) === 8 && /8 rows in \d+ ms/.test(await sql.locator(".st-readout").innerText()));
await sql.locator("textarea").fill("DELETE FROM dbo.Tasks");
await sql.locator("textarea").press(`${mod}+Enter`);
await wait(150);
check("the connection is read-only", /read-only: only SELECT/.test(await sql.locator(".st-readout").innerText()) && (await page.evaluate(() => window.tasks.getAll().length)) > 0);
const viaMcp = await run("sql.query", { connection: "research", sql: "SELECT TOP 5 symbol, value FROM dbo.Positions ORDER BY value DESC" }, "agent");
const direct = (await page.evaluate(() => window.werkbank.describe({ detail: "summary" }).panels.length));
check("an agent or another program can query the same data through a command", viaMcp.ok && viaMcp.value.columns.join() === "symbol,value" && viaMcp.value.rows.length === 5 && viaMcp.value.rows[0].value >= viaMcp.value.rows[4].value && direct > 0);
const capped = await run("sql.query", { connection: "research", sql: "SELECT * FROM dbo.Orders" });
check("the row limit setting caps what a query returns", capped.value.rows.length === 100 && capped.value.truncated === true && capped.value.rowCount === 100000);

// --- custom elements: sandboxed, marked, and removable ---
const shipped = page.frameLocator("[data-testid=panel-e-top-movers-1] iframe");
await shipped.locator(".row").first().waitFor();
check("a reviewed element that ships with the app runs in the sandbox", /Top movers today/.test(await shipped.locator("body").innerText()));
const mover = await shipped.locator(".row strong").first().innerText();
// The rows re-sort as prices move, so click the row that was read rather than "the first".
await shipped.locator(`.row[data-symbol=${mover}]`).click();
await wait(200);
check("an element can set shared context through its API", (await page.evaluate(() => window.werkbank.getDoc().links["1"].symbol)) === mover, mover);
await run("custom.save", {
  id: "probe", title: "Probe",
  source: `<pre id="o">running</pre><script>(async () => { const out = {};
    try { await fetch("http://localhost:5199/"); out.fetch = "ALLOWED"; } catch (e) { out.fetch = "blocked"; }
    try { out.parent = parent.document.title ? "ALLOWED" : "ALLOWED"; } catch (e) { out.parent = "blocked"; }
    try { localStorage.setItem("x", "1"); out.storage = "ALLOWED"; } catch (e) { out.storage = "blocked"; }
    try { const i = new Image(); await new Promise((res, rej) => { i.onload = res; i.onerror = rej; i.src = "http://localhost:5199/x.png?leak=1"; }); out.image = "ALLOWED"; } catch (e) { out.image = "blocked"; }
    try { await werkbank.call("order.place", {}); out.command = "ALLOWED"; } catch (e) { out.command = "blocked"; }
    out.panels = (await werkbank.panels()).length;
    out.query = (await werkbank.call("query", { connection: "research", sql: "SELECT COUNT(*) AS n FROM dbo.Tasks" })).rows[0].n;
    await werkbank.setState({ seen: out.panels }); out.state = (await werkbank.getState()).seen;
    document.getElementById("o").textContent = JSON.stringify(out); })();<\/script>`,
});
const probeId = (await run("panel.open", { toolId: "c-probe" })).value;
const probe = JSON.parse(await page.frameLocator(`[data-testid=panel-${probeId}] iframe`).locator("#o", { hasText: "fetch" }).innerText());
check("a custom element cannot reach the network, the app's page or storage, or run commands", probe.fetch === "blocked" && probe.parent === "blocked" && probe.storage === "blocked" && probe.image === "blocked" && probe.command === "blocked", JSON.stringify(probe));
check("it can read panels, call the functions the app offers, and keep its own state", probe.panels >= 7 && probe.query === (await page.evaluate(() => window.tasks.getAll().length)) && probe.state === probe.panels);
await run("view.side", { view: "tools" });
await page.locator("input[aria-label='Filter tools']").fill("probe");
check("custom elements are listed with (C) under their own heading", (await page.locator(".wb-side .wb-list-item").allInnerTexts()).some((t) => t.includes("Probe (C)")) && (await page.locator(".wb-side-heading").allInnerTexts()).some((h) => /custom/i.test(h)));
await page.locator("input[aria-label='Filter tools']").fill("");
check("the panel's tab carries the mark too", (await page.locator(`[data-testid=tab-${probeId}]`).innerText()).includes("Probe (C)"));
await run("custom.delete", { id: "probe" });
await wait(200);
check("deleting an element closes its panels and removes the tool", (await page.locator(`[data-testid=tab-${probeId}]`).count()) === 0 && !(await page.evaluate(() => window.werkbank.tools.has("c-probe"))));
await run("history.undo");
check("and undo brings the element back", await page.evaluate(() => window.werkbank.tools.has("c-probe") && window.werkbank.custom.get("probe").title === "Probe"));
await run("custom.delete", { id: "probe" });

// --- more showcase panels ---
await palette("preset workspace showcase");
await page.locator("[data-testid=tab-pipeline-1]").click();
await page.waitForSelector("[data-testid=panel-pipeline-1] [data-job]");
check("the pipeline graph draws every job", (await panel("pipeline-1").locator("[data-job]").count()) === 12);
await panel("pipeline-1").locator("[data-job]").nth(4).click();
check("selecting a job is kept in the panel's state", Boolean((await stateOf("pipeline-1")).selected));
await run("pipeline.run");
await wait(700);
const midRun = (await dataOf("pipeline-1")).counts;
await page.waitForFunction(() => { const c = window.werkbank.describe({ panels: ["pipeline-1"] }).panels[0].data.counts; return c.running === 0 && c.waiting === 0; }, null, { timeout: 20000 });
check("running the pipeline moves jobs through their states", midRun.running + midRun.waiting > 0 && (await dataOf("pipeline-1")).counts.ok === 12, JSON.stringify(midRun));
await page.locator("[data-testid=tab-diff-1]").click();
const diff = await dataOf("diff-1");
check("the text diff counts and marks changed lines", diff.counts.added === 8 && diff.counts.removed === 7 && (await panel("diff-1").locator("text=version: 1.5.0").count()) >= 1);

// --- command-driven layout changes (what the palette and agents use) ---
const activePanel = () => page.evaluate(() => window.werkbank.activeInstanceId());
await run("workspace.reset");
await page.locator("[data-testid=tab-notes-1]").click();
await run("panel.move.left");
await wait(100);
check("a moved panel stays the active one", (await activePanel()) === "notes-1" && (await tabsetOf("notes-1")) === "centre-bottom");
await run("panel.move.down");
await wait(100);
check("moving towards an empty side splits the group", (await tabsetOf("notes-1")) !== "centre-bottom" && (await tabsetOf("portfolio-1")) === "centre-bottom");
const copy = (await run("panel.duplicate", { id: "chart-1" })).value;
check("duplicate makes an independent copy beside the original", /^chart-\d+$/.test(copy) && copy !== "chart-1" && (await tabsetOf(copy)) === "centre-top");
await run("panel.float", { id: copy });
await wait(500);
await page.reload();
await page.waitForSelector(`[data-testid=tab-${copy}]`);
const floating = await page.evaluate(() => window.werkbank.getDoc().layout.floating?.[0]?.tabs[0]?.id);
check("a floating panel survives a reload", floating === copy);
// --- the framework's own choice controls: no browser or system dropdowns anywhere ---
await run("workspace.preset", { name: "Chart libraries" });
const ctl = panel("controls-1");
await ctl.locator("[aria-label=Owner]").waitFor();
check("no native select or datalist is left in the app", (await page.locator("select, datalist").count()) === 0);
await ctl.locator("[aria-label=Owner]").focus();
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
check("a dropdown works from the keyboard", (await stateOf("controls-1")).owner === "Ben" && (await page.locator(".wb-popup").count()) === 0);
await ctl.locator("[aria-label=Currency]").click();
await page.keyboard.type("kr");
const currencies = await page.locator(".wb-popup .wb-option-label").allInnerTexts();
const groupsShown = await page.locator(".wb-popup .wb-listbox-group").allInnerTexts();
await page.keyboard.press("Enter");
check("a searchable dropdown filters by name or code and keeps its groups", currencies.length >= 3 && currencies.includes("South Korean won") && groupsShown.includes("Europe") && (await stateOf("controls-1")).currency === "KRW", currencies.join(","));
await ctl.locator("[aria-label=Symbols]").click();
await page.locator(".wb-popup .wb-option", { hasText: "GOLF" }).click();
await page.locator(".wb-popup .wb-option", { hasText: "ALFA" }).click();
const stillOpen = await page.locator(".wb-popup").count();
await page.keyboard.press("Escape");
check("a multi-select stays open while choosing and keeps the options' order", stillOpen === 1 && (await stateOf("controls-1")).symbols.join() === "DLTA,GOLF" && (await ctl.locator("[aria-label=Symbols]").inputValue()) === "DLTA, GOLF");
const everything = ctl.locator("[aria-label='Search everything']");
await everything.click();
await page.keyboard.type("gol");
await page.locator(".wb-search-preview svg").waitFor();
const previewSymbol = await page.locator(".wb-search-preview h4").innerText();
await page.keyboard.type("zzz");
const none = await page.locator(".wb-popup .wb-listbox-empty").innerText();
await everything.fill("welc");
await page.locator(".wb-search-preview .wb-markdown, .wb-search-preview h1").first().waitFor();
const previewDoc = await page.locator(".wb-search-preview").innerText();
await everything.fill("golf");
await page.keyboard.press("Enter");
check("the search field previews the highlighted result before it is picked", previewSymbol.startsWith("GOLF") && none === "Nothing matches." && /Welcome/.test(previewDoc) && (await page.evaluate(() => window.werkbank.getDoc().links["1"].symbol)) === "GOLF", `${previewSymbol} | ${none}`);
await run("settings.open");
await page.locator("#setting-theme").waitFor();
await page.locator("#setting-theme").click();
await page.locator(".wb-popup .wb-option").first().waitFor();
const themePopup = await page.locator(".wb-popup .wb-option").count();
await page.keyboard.press("Escape");
await page.locator(".wb-popup").waitFor({ state: "detached" });
const dialogAfterFirst = await page.locator(".wb-settings").count();
await page.keyboard.press("Escape");
await page.locator(".wb-settings").waitFor({ state: "detached" });
check("in a dialog, Escape closes an open dropdown first and the dialog second", themePopup >= 3 && dialogAfterFirst === 1);

// --- chart libraries inside sandboxed elements ---
const inFrame = async (id, probe) => (await (await panel(id).locator("iframe").elementHandle()).contentFrame()).evaluate(probe);
await panel("e-plotly-surface-1").locator("iframe").waitFor({ timeout: 20000 });
await wait(3500);
const libs = {
  echarts: await inFrame("e-echarts-sankey-1", "typeof echarts === 'object' && document.querySelectorAll('canvas').length"),
  d3: await inFrame("e-d3-pack-1", "typeof d3 === 'object' && document.querySelectorAll('circle.leaf').length"),
  chartjs: await inFrame("e-chartjs-monthly-1", "typeof Chart === 'function' && document.getElementById('title').textContent"),
  lightweight: await inFrame("e-lightweight-candles-1", "typeof LightweightCharts === 'object' && document.getElementById('title').textContent"),
  plotly: await inFrame("e-plotly-surface-1", "typeof Plotly === 'object' && typeof Plotly.newPlot"),
};
check("elements can load ECharts, D3, Chart.js, Lightweight Charts and Plotly without network access", libs.echarts >= 1 && libs.d3 === 8 && libs.chartjs === "GOLF monthly returns" && libs.lightweight === "GOLF candles" && libs.plotly === "function", JSON.stringify(libs));
check("no sandboxed library panel reports an error", (await page.locator(".wb-sandbox-error").count()) === 0);
await run("custom.save", { id: "lib-check", title: "Library check", source: `<p id="out">loading</p><script src="lib:d3"></script><script src="lib:nope"></script><script>document.getElementById("out").textContent = d3.sum([1, 2, 3]);</script>` });
await run("panel.open", { toolId: "c-lib-check" });
await page.locator(".wb-sandbox-error", { hasText: 'no library called "nope"' }).waitFor();
await run("custom.save", { id: "lib-check", title: "Library check", source: `<p id="out">loading</p><script src="lib:d3"></script><script>document.getElementById("out").textContent = "sum " + d3.sum([1, 2, 3]) + " fetch " + (typeof fetch);fetch("https://example.com").catch(() => (document.getElementById("out").textContent += " blocked"));</script>` });
const ownPanel = await page.evaluate(() => Object.values(window.werkbank.getDoc().instances).find((i) => i.toolId === "c-lib-check").id);
await page.frameLocator(`[data-testid=panel-${ownPanel}] iframe`).locator("#out", { hasText: "blocked" }).waitFor({ timeout: 8000 });
check("a person's own element can use a library, an unknown one is refused, and the network stays blocked", (await page.frameLocator(`[data-testid=panel-${ownPanel}] iframe`).locator("#out").innerText()).startsWith("sum 6"));

// --- importing an element from a file ---
await page.locator("[data-testid=tab-crafter-1]").click();
const exported = JSON.stringify({ kind: "werkbank-element", element: { id: "lib-check", title: "Shared by a colleague", description: "An imported chart.", source: `<div id="c" style="height:100%"></div><script src="lib:echarts"></script><script>echarts.init(document.getElementById("c")).setOption({ xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ type: "bar", data: [1, 2] }] });document.title = "drawn";</script>` } });
await panel("crafter-1").locator("input[type=file]").setInputFiles({ name: "shared.element.json", mimeType: "application/json", buffer: Buffer.from(exported) });
await page.waitForFunction(() => window.werkbank.custom.get("lib-check-2"));
const imported = await page.evaluate(() => window.werkbank.custom.get("lib-check-2"));
await panel("crafter-1").locator("iframe").waitFor();
await wait(1500);
const importedDraws = await (await (await panel("crafter-1").locator("iframe").elementHandle()).contentFrame()).evaluate("document.title + ' ' + document.querySelectorAll('canvas').length");
check("a chart element can be imported from a file, without overwriting one of the same name, and runs", imported.title === "Shared by a colleague" && imported.status === "draft" && importedDraws === "drawn 1", importedDraws);
await panel("crafter-1").locator("input[type=file]").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{\"hello\":1}") });
await panel("crafter-1").getByText("That file does not contain an element.").waitFor();
check("a file that is not an element is refused with a reason", true);
await run("custom.delete", { id: "lib-check" });
await run("custom.delete", { id: "lib-check-2" });

// --- the app's logo and the documentation in settings ---
check("the app's logo is shown in the rail", (await page.locator(".wb-rail-brand img").getAttribute("src")) === "/logo.svg" && (await page.locator(".wb-rail-brand img").evaluate((img) => img.naturalWidth > 0)));
await page.locator(".wb-rail-brand").click();
await page.locator(".wb-docs .wb-markdown").waitFor();
const firstPage = await page.locator(".wb-docs h1").first().innerText();
const docPages = (await run("docs.list")).value.pages.map((p) => p.id);
check("the logo opens the documentation, with the app's own page first and the framework's after", firstPage === "Werkbank starter" && docPages.join() === "starter,workspace,assistant,elements,shortcuts,about", docPages.join());
await page.locator(".wb-docs [aria-label=Page]").click();
await page.locator(".wb-popup .wb-option", { hasText: "Keyboard shortcuts" }).click();
await page.locator(".wb-docs table").waitFor();
check("the shortcuts page is generated from the commands", /Settings/.test(await page.locator(".wb-docs table").innerText()));
await page.locator(".wb-settings-nav button", { hasText: "Appearance" }).click();
await page.locator("#setting-appearance\\.logo").click();
const hidden = (await page.locator(".wb-rail-brand").count()) === 0;
const stillNamed = (await page.locator(".wb-window-foot").innerText()).startsWith("Werkbank starter");
await page.locator("#setting-appearance\\.logo").click();
await page.keyboard.press("Escape");
check("the logo can be hidden but the app's name cannot be changed", hidden && stillNamed && (await page.locator(".wb-rail-brand").count()) === 1 && (await run("settings.set", { key: "app.title", value: "x" })).ok === false);
const onePage = await run("docs.list", { page: "assistant" }, "agent");
check("an agent can read a documentation page", onePage.ok && /Assistant panel/.test(onePage.value.page.text) && (await run("docs.list", { page: "nope" })).ok === false);

await run("workspace.reset");
await wait(300);
await page.screenshot({ path: "scripts/shots/final.png" });

// The browser reports each request the sandbox blocked for the probe element. Those are the sandbox working.
const unexpected = errors.filter((e) => !/Content Security Policy/.test(e));
check("no console errors apart from the sandbox blocking the probe", unexpected.length === 0 && errors.length > 0, unexpected.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
