// Launches Chromium for the check scripts. Uses Playwright's own download when
// present, otherwise any Chromium already in the Playwright cache.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

function cached() {
  const root = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const exe = join(root, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (existsSync(exe)) return exe;
  }
}

export async function launch() {
  const executablePath = process.env.CHROME ?? (existsSync(chromium.executablePath()) ? undefined : cached());
  return chromium.launch(executablePath ? { executablePath } : {});
}
