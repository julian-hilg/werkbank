#!/usr/bin/env node
// Checks a Werkbank app for the rules a compiler does not see.
//   node check.mjs [app folder]     default: the current folder (or its starter/ in a Werkbank checkout)
// Exits with 1 when a rule is broken. Warnings do not fail the check.
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
  if (isTool(file)) each(file, (l) => /\b(localStorage|sessionStorage)\b/.test(l), (at) => problems.push(`${at}  a panel using browser storage. Panel state goes through useToolState, data through a store.`));
  const text = file.lines.join("\n");
  if (/\bdefineTool\s*[<(]/.test(text)) {
    if (!/\bdescribe\s*[:(]/.test(text)) problems.push(`${file.name}  a tool without describe. Return the data behind the view so an agent can read it.`);
    if (!/\bstateSchema\b/.test(text)) warnings.push(`${file.name}  a tool without stateSchema: its saved state is not validated.`);
  }
}

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
