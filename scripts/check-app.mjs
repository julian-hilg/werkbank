// Proves that a framework release reaches an app: packs the framework, scaffolds an app from the
// tarballs, installs it, type-checks and builds it, then runs the app's own update script against
// the same tarballs. npm run check:app
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (command, cwd) => execSync(command, { cwd, stdio: "inherit" });
run("node scripts/pack.mjs", repo);
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
  console.log("\nAn app scaffolded from the packed release installs, type-checks, builds and updates.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
