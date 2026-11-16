// Builds the framework and packs its three packages into release/ as tarballs.
// These are what a tagged release publishes and what apps install. npm run pack
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "release");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
execSync("npm run build:framework", { cwd: repo, stdio: "inherit" });
execSync("node packages/chart-libraries/vendor.mjs", { cwd: repo, stdio: "inherit" });
for (const pkg of ["framework", "bridge", "chart-libraries"]) execSync(`npm pack --ignore-scripts --pack-destination "${out}"`, { cwd: join(repo, "packages", pkg), stdio: ["ignore", "ignore", "inherit"] });
console.log(`Packed into release/:\n${readdirSync(out).map((f) => `  ${f}`).join("\n")}`);
