// Installs the werkbank-app skill for coding agents: npm run skill:install [-- <folder>]
// Without a folder it goes to your personal skills (~/.claude/skills), where Claude Code finds it in every project.
// With a folder it goes to <folder>/.claude/skills, for one app. Apps made with "npm run new:app" already have it.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "packages", "framework", "skills", "werkbank-app");
const folder = process.argv[2];
const target = join(folder ? resolve(folder) : homedir(), ".claude", "skills", "werkbank-app");
if (folder && !existsSync(resolve(folder))) {
  console.error(`${resolve(folder)} does not exist.`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`Installed the werkbank-app skill in ${target}.\nStart a new agent session to pick it up. Run this again after updating Werkbank.`);
