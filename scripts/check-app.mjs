// Proves that a framework release reaches an app: packs the framework, scaffolds an app from the
// tarballs, installs it, type-checks and builds it, starts its dev server, then runs the app's own update script against
// the same tarballs. npm run check:app
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (command, cwd) => execSync(command, { cwd, stdio: "inherit" });
run("node scripts/pack.mjs", repo);
// Every tarball carries its licence; the chart libraries' one also carries the texts of what it redistributes.
const version = JSON.parse(readFileSync(join(repo, "packages/framework/package.json"), "utf8")).version;
const listing = (pkg) => execSync(`tar -tzf "${join(repo, "release", `werkbank-${pkg}-${version}.tgz`)}"`, { encoding: "utf8" }).split("\n");
for (const pkg of ["framework", "bridge", "chart-libraries"]) if (!listing(pkg).includes("package/LICENSE")) throw new Error(`The ${pkg} tarball has no LICENSE.`);
const charts = listing("chart-libraries");
for (const file of ["THIRD-PARTY-NOTICES.md", "vendor/licenses/echarts/LICENSE", "vendor/licenses/echarts/NOTICE", "vendor/licenses/d3/LICENSE", "vendor/licenses/chartjs/LICENSE.md", "vendor/licenses/lightweight-charts/LICENSE", "vendor/licenses/plotly/LICENSE"])
  if (!charts.includes(`package/${file}`)) throw new Error(`The chart-libraries tarball is missing ${file}.`);
// A tarball is already built: a "prepare" left in its manifest refers to sources it does not carry.
for (const pkg of ["framework", "bridge", "chart-libraries"]) {
  const manifest = JSON.parse(execSync(`tar -xOzf "${join(repo, "release", `werkbank-${pkg}-${version}.tgz`)}" package/package.json`, { encoding: "utf8" }));
  if (manifest.scripts?.prepare) throw new Error(`The ${pkg} tarball still declares a prepare script.`);
}

/** Starts the app's dev server (without the bridge) and checks that it serves the page and the chart libraries, and stays up. */
async function checkDevServer(app) {
  const port = 5290;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [join(app, "node_modules/vite/bin/vite.js"), "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: app, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", (d) => (output += d));
  server.stderr.on("data", (d) => (output += d));
  const exited = new Promise((resolve) => server.on("exit", resolve));
  const fail = (why) => new Error(`The app's dev server ${why}.\n${output}`);
  const get = async (path) => {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw fail(`answered ${response.status} for ${path}`);
    return response.text();
  };
  try {
    for (let i = 0; ; i++) {
      if (server.exitCode !== null) throw fail("stopped while starting");
      try {
        await get("/");
        break;
      } catch (error) {
        if (i >= 60 || error.message.startsWith("The app's")) throw error;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await get("/src/main.tsx");
    if (!(await get("/node_modules/@werkbank/chart-libraries/vendor/d3.js?raw")).startsWith("export default")) throw fail("did not serve a chart library as text");
    // Dependency pre-bundling runs in the background after the first requests; give it time to fail.
    const stopped = await Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]);
    if (stopped) throw fail("stopped after starting");
  } finally {
    server.kill();
  }
}

const dir = mkdtempSync(join(tmpdir(), "werkbank-app-"));
const app = join(dir, "sample-app");
try {
  run(`node scripts/create-app.mjs "${app}" "Sample App" --from "${join(repo, "release")}"`, repo);
  run("npm install --no-audit --no-fund", app);
  run("npm run typecheck", app);
  run("npm run build", app);
  await checkDevServer(app);
  run(`npm run werkbank:update -- --from "${join(repo, "release")}"`, app);
  const guide = readFileSync(join(app, "node_modules/@werkbank/framework/GUIDE.md"), "utf8");
  if (!guide.includes("Werkbank")) throw new Error("The agent guide did not arrive with the package.");
  // The development skill: scaffolded into the app, refreshed by the update, and its rule check passes on a fresh app
  // and fails on a broken one.
  const skill = join(app, ".claude/skills/werkbank-app");
  rmSync(skill, { recursive: true, force: true });
  run(`npm run werkbank:update -- --from "${join(repo, "release")}"`, app);
  for (const file of ["SKILL.md", "backend.md", "frontend.md", "scripts/check.mjs", "scripts/dev.mjs"]) if (!existsSync(join(skill, file))) throw new Error(`The update did not restore the skill's ${file}.`);
  run("npm run check:rules", app);
  writeFileSync(join(app, "src/tools/broken.tsx"), `import { defineTool } from "@werkbank/framework/dist/index.js";\nexport const broken = defineTool({ id: "broken", title: "Broken", component: () => <select style={{ color: "#ff0000" }} /> });\n`);
  let caught = false;
  try {
    execSync("npm run check:rules", { cwd: app, stdio: "ignore" });
  } catch {
    caught = true;
  }
  if (!caught) throw new Error("The skill's rule check accepted a tool with a literal colour, a native dropdown, a deep import and no describe.");
  console.log("\nAn app scaffolded from the packed release installs, type-checks, builds, runs its dev server and updates, and carries the development skill.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
