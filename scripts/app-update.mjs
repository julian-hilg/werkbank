// Moves this app to another version of the Werkbank framework.
//
//   npm run werkbank:update                  the newest release
//   npm run werkbank:update -- 0.7.0         a specific release
//   npm run werkbank:update -- --from <dir>  package tarballs in a folder (what "npm run pack" writes in a Werkbank checkout)
//   npm run werkbank:update -- --local <dir> link a Werkbank checkout, to work on app and framework together
//
// It rewrites the three @werkbank dependencies, installs, and type-checks the app. The framework's types are the
// first line of defence: anything an update removed or renamed fails to compile. Then read the changelog it points to.
import { execSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const PACKAGES = ["framework", "bridge", "chart-libraries"];
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const repo = manifest.werkbank?.repo ?? "julian-hilg/werkbank";
const installed = () => {
  try {
    return JSON.parse(readFileSync("node_modules/@werkbank/framework/package.json", "utf8")).version;
  } catch {
    return "none";
  }
};
const before = installed();

let source;
let describe;
if (option("--local")) {
  const dir = resolve(option("--local"));
  if (!existsSync(join(dir, "packages", "framework", "package.json"))) throw new Error(`${dir} is not a Werkbank checkout.`);
  if (!existsSync(join(dir, "packages", "framework", "dist", "index.js"))) execSync("npm run build:framework", { cwd: dir, stdio: "inherit" });
  source = (pkg) => `file:${relative(process.cwd(), join(dir, "packages", pkg))}`;
  describe = `the checkout at ${dir}`;
} else if (option("--from")) {
  const dir = resolve(option("--from"));
  const version = readdirSync(dir).map((f) => /^werkbank-framework-(.+)\.tgz$/.exec(f)?.[1]).find(Boolean);
  if (!version) throw new Error(`${dir} holds no werkbank-framework-<version>.tgz.`);
  source = (pkg) => `file:${join(dir, `werkbank-${pkg}-${version}.tgz`)}`;
  describe = `${version} from ${dir}`;
} else {
  let version = args.find((a) => /^v?\d+\.\d+\.\d+/.test(a))?.replace(/^v/, "");
  if (!version) {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(`Could not ask GitHub for the newest release of ${repo} (HTTP ${response.status}). Name a version instead: npm run werkbank:update -- 0.7.0`);
    version = (await response.json()).tag_name.replace(/^v/, "");
  }
  source = (pkg) => `https://github.com/${repo}/releases/download/v${version}/werkbank-${pkg}-${version}.tgz`;
  describe = `release ${version}`;
}

for (const pkg of PACKAGES) if (manifest.dependencies[`@werkbank/${pkg}`]) manifest.dependencies[`@werkbank/${pkg}`] = source(pkg);
writeFileSync("package.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`Moving to ${describe}…`);
execSync("npm install", { stdio: "inherit" });
const after = installed();
console.log(`\nWerkbank ${before} -> ${after}`);
// The development skill for coding agents ships in the package; keep the app's copy at the installed version.
const skill = "node_modules/@werkbank/framework/skills/werkbank-app";
if (existsSync(skill)) {
  rmSync(".claude/skills/werkbank-app", { recursive: true, force: true });
  cpSync(skill, ".claude/skills/werkbank-app", { recursive: true, dereference: true });
  console.log("Refreshed the development skill in .claude/skills/werkbank-app.");
}
try {
  execSync("npm run typecheck", { stdio: "inherit" });
  console.log("\nThe app type-checks against the new version.");
} catch {
  console.log("\nThe app no longer type-checks. The errors above are what this update changed; the changelog says how to adapt.");
  process.exitCode = 1;
}
console.log(`Changelog: node_modules/@werkbank/framework/CHANGELOG.md
Agent guide: node_modules/@werkbank/framework/GUIDE.md
Agent skill: .claude/skills/werkbank-app/SKILL.md
Then open the app with a workspace saved under the old version; notices about repaired panels appear in the status bar.`);
