#!/usr/bin/env node
// Checks a Werkbank app for the rules a compiler does not see.
//   node check.mjs [app folder]     default: the current folder (or its starter/ in a Werkbank checkout)
// Exits with 1 when a rule is broken. Warnings do not fail the check.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const given = resolve(process.argv[2] ?? ".");
const root = [given, join(given, "starter")].find((dir) => existsSync(join(dir, "src", "app.ts")));
if (!root) {
  console.error(`${given} is not a Werkbank app: there is no src/app.ts. Pass the app's folder.`);
  process.exit(2);
}
const src = join(root, "src");
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
const files = walk(src).map((path) => ({ path, name: relative(root, path), lines: readFileSync(path, "utf8").split("\n") }));
const isTool = (file) => file.path.startsWith(join(src, "tools") + sep);
const code = (line) => !/^\s*(\/\/|\*|\/\*)/.test(line);

const ENTRY_POINTS = new Set(["@werkbank/framework", "@werkbank/framework/core", "@werkbank/framework/styles.css", "@werkbank/bridge", "@werkbank/chart-libraries"]);
const problems = [];
const warnings = [];
const each = (file, test, report) => file.lines.forEach((line, i) => code(line) && test(line) && report(`${file.name}:${i + 1}`, line.trim()));

for (const file of files) {
  if (file.path.endsWith(".tsx")) {
    each(file, (l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(l), (at) => problems.push(`${at}  a literal colour. Use a --wb-* token.`));
    each(file, (l) => /<(select|datalist)\b/.test(l), (at) => problems.push(`${at}  a native dropdown. Use Select, MultiSelect or SearchBox from @werkbank/framework.`));
  }
  each(
    file,
    (l) => [...l.matchAll(/(?:from|import)\s*\(?\s*["'](@werkbank\/[^"']+)["']/g)].some((m) => !ENTRY_POINTS.has(m[1])),
    (at) => problems.push(`${at}  an import from inside a @werkbank package. Import the package's entry point.`),
  );
  each(file, (l) => /node_modules\/@werkbank/.test(l), (at) => problems.push(`${at}  a path into node_modules/@werkbank. The framework is never reached by path.`));
  each(file, (l) => /keys:\s*["'`][^"'`]*\balt\b/i.test(l), (at) => problems.push(`${at}  an Alt-key shortcut. They collide with browser and system menus.`));
  // A credential in source is in the repository and in every browser that loads the app.
  each(
    file,
    (l) => /\bBearer\s+[A-Za-z0-9._~+/-]{24,}|\b(sk|pk|rk)-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(l),
    (at) => problems.push(`${at}  what looks like a credential in source. Put it in .env as WERKBANK_SECRET_<NAME> and use it by name through the bridge.`),
  );
  each(
    file,
    (l) => /import\.meta\.env\.VITE_\w*(SECRET|TOKEN|PASSWORD|API_?KEY|PRIVATE)/i.test(l),
    (at) => problems.push(`${at}  a secret read from a VITE_ variable. The build copies those into the page for anyone to read; use a WERKBANK_SECRET_ in .env through the bridge.`),
  );
  if (isTool(file)) each(file, (l) => /\b(localStorage|sessionStorage)\b/.test(l), (at) => problems.push(`${at}  a panel using browser storage. Panel state goes through useToolState, data through a store.`));
  const text = file.lines.join("\n");
  // A request that changes something elsewhere must wait for the person when an agent asks for it.
  if (/["']http\.request["']/.test(text) && !/risk:\s*["'](external|irreversible)["']/.test(text))
    problems.push(`${file.name}  uses "http.request" without an "external" (or "irreversible") command. A request that changes something outside the app goes through such a command, so an agent's waits for approval.`);
  if (/\bdefineTool\s*[<(]/.test(text)) {
    if (!/\bdescribe\s*[:(]/.test(text)) problems.push(`${file.name}  a tool without describe. Return the data behind the view so an agent can read it.`);
    if (!/\bstateSchema\b/.test(text)) warnings.push(`${file.name}  a tool without stateSchema: its saved state is not validated.`);
  }
}

// Secrets: the file that holds them must be yours alone and must never reach the repository.
const envFile = join(root, ".env");
if (existsSync(envFile)) {
  if (process.platform !== "win32" && (statSync(envFile).mode & 0o077) !== 0) problems.push(".env  can be read by other users of this computer. Run: chmod 600 .env");
  try {
    execFileSync("git", ["-c", "core.fsmonitor=false", "check-ignore", "-q", ".env"], { cwd: root, stdio: "ignore" });
  } catch (error) {
    if (error?.status === 1) problems.push(".env  is not ignored by git. Add a line `.env` to .gitignore; if it was ever committed, change the secrets in it.");
  }
}
const vite = ["ts", "js", "mjs"].map((ext) => join(root, `vite.config.${ext}`)).find((path) => existsSync(path));
if (vite && /["']\/__bridge["']/.test(readFileSync(vite, "utf8")) && !/bridgeProxy/.test(readFileSync(vite, "utf8")))
  warnings.push("vite.config  forwards to the bridge by hand. Use bridgeProxy() from @werkbank/bridge/vite, so conversations are kept in the app's folder and secrets from .env can be used.");

// A tool nobody lists cannot be opened.
const app = readFileSync(join(src, "app.ts"), "utf8");
const others = (file) => files.filter((f) => f !== file).map((f) => f.lines.join("\n"));
for (const file of files.filter(isTool)) {
  for (const match of file.lines.join("\n").matchAll(/export const (\w+)\s*=\s*defineTool\b/g)) {
    const name = match[1];
    const used = new RegExp(`\\b${name}\\b`);
    if (!used.test(app) && !others(file).some((text) => used.test(text))) warnings.push(`${file.name}  "${name}" is defined but not listed in tools in src/app.ts.`);
  }
}

const label = relative(process.cwd(), root) || ".";
for (const line of warnings) console.log(`warning  ${line}`);
for (const line of problems) console.log(`error    ${line}`);
if (problems.length) {
  console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"} in ${label} (${files.length} files).`);
  process.exit(1);
}
console.log(`${label}: ${files.length} files follow the Werkbank rules${warnings.length ? `, with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}.`);
