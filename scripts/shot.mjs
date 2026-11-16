// Usage: node scripts/shot.mjs <name> [js to evaluate before the screenshot]
import { launch } from "./browser.mjs";

const [name = "shot", script] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:5199/");
await page.waitForSelector(".wb-root");
await page.waitForTimeout(400);
if (script) console.log("eval:", JSON.stringify(await page.evaluate(script)));
await page.waitForTimeout(300);
await page.screenshot({ path: `scripts/shots/${name}.png` });
console.log("errors:", errors.length ? errors : "none");
await browser.close();
