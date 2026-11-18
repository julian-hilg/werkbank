// Builds the framework and packs its three packages into release/ as tarballs.
// These are what a tagged release publishes and what apps install. npm run pack
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "release");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
execSync("npm run build:framework", { cwd: repo, stdio: "inherit" });
execSync("node packages/chart-libraries/vendor.mjs", { cwd: repo, stdio: "inherit" });
for (const pkg of ["framework", "bridge", "chart-libraries"]) {
  const dir = join(repo, "packages", pkg);
  const manifest = join(dir, "package.json");
  const original = readFileSync(manifest, "utf8");
  // "prepare" builds a package inside this checkout. A tarball is already built and lacks the
  // sources, so the published manifest leaves it out (npm 11 would warn about it on every install).
  const published = JSON.parse(original);
  delete published.scripts?.prepare;
  if (published.scripts && Object.keys(published.scripts).length === 0) delete published.scripts;
  try {
    writeFileSync(manifest, `${JSON.stringify(published, null, 2)}\n`);
    execSync(`npm pack --ignore-scripts --pack-destination "${out}"`, { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
  } finally {
    writeFileSync(manifest, original);
  }
}
console.log(`Packed into release/:\n${readdirSync(out).map((f) => `  ${f}`).join("\n")}`);
