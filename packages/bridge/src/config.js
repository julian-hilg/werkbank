/**
 * Where a bridge belongs. Every app has a bridge of its own: one process, one
 * port, one folder. Sharing a bridge between apps is refused (see server.js),
 * because a bridge holds its app's files and secrets.
 *
 *   home   the app's folder: `--home <dir>` or the folder the bridge was started in
 *   port   BRIDGE_PORT, or "werkbank": { "bridgePort": … } in the app's package.json, or 8787
 *
 * The app's dev server reads the same two values (see vite.js), so both ends
 * agree without being told twice.
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

export const DEFAULT_PORT = 8787;

/** The folder as the file system knows it, so two spellings of one folder compare equal. */
export function homeAt(dir) {
  const wanted = resolve(dir ?? process.cwd());
  try {
    return realpathSync(wanted);
  } catch {
    return wanted;
  }
}

export function portOf(home, env = process.env) {
  if (env.BRIDGE_PORT) return Number(env.BRIDGE_PORT);
  try {
    const port = JSON.parse(readFileSync(join(home, "package.json"), "utf8")).werkbank?.bridgePort;
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  } catch {
    /* no package.json there, or not JSON: the default applies */
  }
  return DEFAULT_PORT;
}

/** Names a folder without revealing it: what one bridge tells another so they can see whether they serve the same app. */
export const homeId = (home) => createHash("sha256").update(home).digest("hex").slice(0, 16);

/** The value after a command-line flag, if the flag is there. */
export const flag = (name, argv = process.argv) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
