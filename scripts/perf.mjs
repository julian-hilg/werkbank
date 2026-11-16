// Measures how the app behaves under the live feed: node scripts/perf.mjs
// Reports frame pacing and long tasks for each preset over a few seconds.
import { launch } from "./browser.mjs";

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto(process.env.APP_URL ?? "http://localhost:5199/");
await page.waitForTimeout(800);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("starter.settings", JSON.stringify({ "assistant.connect": false })); // this run does not involve the agent bridge
});
const t0 = Date.now();
await page.reload();
await page.waitForSelector("[data-testid=panel-chart-1] canvas");
const load = Date.now() - t0;
const transfer = await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => /\.(js|css|json)(\?|$)/.test(r.name) || r.name.includes("/src/") || r.name.includes("/node_modules/")).length);
console.log(`reload to first chart: ${load} ms (${transfer} module requests in dev mode)`);
await page.waitForFunction(() => window.feed.getStatus() === "live");

for (const preset of ["Trading desk", "Analytics", "Showcase", "Tasks"]) {
  await page.evaluate((n) => window.werkbank.run("workspace.preset", { name: n }), preset);
  await page.waitForTimeout(1500);
  const result = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const frames = [];
        let long = 0;
        let longest = 0;
        const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => (long++, (longest = Math.max(longest, e.duration)))));
        observer.observe({ entryTypes: ["longtask"] });
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          frames.push(now - last);
          last = now;
          if (now - start < 5000) requestAnimationFrame(tick);
          else {
            observer.disconnect();
            frames.sort((a, b) => a - b);
            resolve({ fps: Math.round((frames.length / (now - start)) * 1000), p95: Math.round(frames[Math.floor(frames.length * 0.95)]), worst: Math.round(frames.at(-1)), long, longest: Math.round(longest) });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(`${preset.padEnd(13)} ${result.fps} fps, 95% of frames within ${result.p95} ms, worst ${result.worst} ms, ${result.long} long tasks (longest ${result.longest} ms)`);
}
await browser.close();
