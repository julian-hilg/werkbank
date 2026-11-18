// Proves that a framework release reaches an app: packs the framework, scaffolds an app from the
// tarballs, installs it, type-checks and builds it, then runs the app's own update script against
// the same tarballs. npm run check:app
import { execSync } from "node:child_process";
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
const dir = mkdtempSync(join(tmpdir(), "werkbank-app-"));
const app = join(dir, "sample-app");
try {
  run(`node scripts/create-app.mjs "${app}" "Sample App" --from "${join(repo, "release")}"`, repo);
  run("npm install --no-audit --no-fund", app);
  run("npm run typecheck", app);
  run("npm run build", app);
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
  console.log("\nAn app scaffolded from the packed release installs, type-checks, builds and updates, and carries the development skill.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
