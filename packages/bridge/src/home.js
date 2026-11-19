/**
 * An app's home: the folder its dev server runs in. Two things live there that
 * must not live in a browser:
 *
 *   .werkbank/   files the app keeps on this machine (the assistant's conversations)
 *   .env         secrets the app may use to reach APIs and other MCP servers
 *
 * A bridge belongs to one app and knows its folder from where it was started
 * (see config.js). What remains to decide is which pages may use it. The
 * app's own dev server adds the header `x-werkbank-home` when it forwards the
 * app's connection (see vite.js). A web page cannot set headers on a
 * WebSocket, so a page can only come with that header through a dev server,
 * and the bridge accepts it only when the header names this bridge's own
 * folder and the page was served by that same server (the Origin equals the
 * Host). A page from anywhere else, from another local port, or from another
 * app's dev server gets no files and no secrets. Nothing a page sends is ever
 * used as a path.
 *
 * Secrets:
 *   - Only variables named WERKBANK_SECRET_<NAME> are secrets. Each needs
 *     WERKBANK_SECRET_<NAME>_HOSTS, the hosts it may be sent to. No hosts, no use.
 *   - A value is never sent to the app, never logged and never put into this
 *     process's environment (so agents the bridge starts do not inherit it).
 *     The app refers to a secret by name; the bridge attaches the value to the
 *     outgoing request after checking the host, and removes it from the answer.
 *   - The file must be a regular file owned by you that no one else can read,
 *     and git must not be tracking it. Otherwise no secret is used.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export const HOME_HEADER = "x-werkbank-home";
const STORE_DIR = ".werkbank";
/** The files an app may keep, by the name it asks for. A page never names a path. */
const STORES = { conversations: "conversations.json", data: "app-data.json" };
const STORE_LIMIT = 20_000_000;
const ENV_LIMIT = 200_000;
const PREFIX = "WERKBANK_SECRET_";
const POSIX = process.platform !== "win32";

/**
 * The home an incoming app connection may use: this bridge's own (`own`), or
 * null. `request` is the HTTP request that opened the WebSocket.
 */
export function homeOf(request, own) {
  const claimed = request.headers[HOME_HEADER];
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof claimed !== "string" || !claimed || !origin || !host || !own) return null;
  // The page must have been served by the dev server that forwarded this connection.
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return null;
  }
  if (originHost !== host) return null;
  if (!isAbsolute(claimed)) return null;
  // And that dev server must be this app's: the folder it names is the one this bridge was started for.
  try {
    return realpathSync(claimed) === own && statSync(own).isDirectory() ? own : null;
  } catch {
    return null;
  }
}

// ---- files the app keeps -------------------------------------------------------

function storePath(home, name) {
  const file = Object.hasOwn(STORES, name) ? STORES[name] : null;
  if (!file) throw new Error(`The bridge keeps no file called "${name}".`);
  return join(home, STORE_DIR, file);
}

/** The folder, private to you, created on first use. A folder that is a link to somewhere else is refused. */
function storeDir(home) {
  const dir = join(home, STORE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { mode: 0o700 });
    // Whoever commits the app's folder should not commit what is in here.
    writeFileSync(join(dir, ".gitignore"), "*\n", { mode: 0o600 });
  }
  const info = lstatSync(dir);
  if (!info.isDirectory()) throw new Error(`${STORE_DIR} in the app's folder is not a folder of its own (it may be a link). The bridge does not write there.`);
  if (POSIX && (info.mode & 0o077) !== 0) chmodSync(dir, 0o700);
  return dir;
}

export function storeRead(home, name) {
  const path = storePath(home, name);
  if (!existsSync(path)) return { text: null };
  const info = lstatSync(path);
  if (!info.isFile()) throw new Error(`${STORE_DIR}/${STORES[name]} is not a regular file.`);
  if (info.size > STORE_LIMIT) throw new Error(`${STORE_DIR}/${STORES[name]} is larger than the bridge reads (${STORE_LIMIT / 1_000_000} MB).`);
  return { text: readFileSync(path, "utf8") };
}

export function storeWrite(home, name, text) {
  const path = storePath(home, name);
  if (typeof text !== "string") throw new Error("Nothing to write.");
  if (text.length > STORE_LIMIT) throw new Error(`That is more than the bridge keeps in one file (${STORE_LIMIT / 1_000_000} MB).`);
  try {
    JSON.parse(text);
  } catch {
    throw new Error("The bridge only keeps JSON.");
  }
  const dir = storeDir(home);
  if (existsSync(path) && !lstatSync(path).isFile()) throw new Error(`${STORE_DIR}/${STORES[name]} is not a regular file.`);
  // Written beside the file and moved into place, so a crash cannot leave half a file.
  const temporary = join(dir, `.${STORES[name]}.${process.pid}.tmp`);
  writeFileSync(temporary, text, { mode: 0o600 });
  renameSync(temporary, path);
  return { bytes: Buffer.byteLength(text) };
}

// ---- secrets ---------------------------------------------------------------------

/** KEY=value lines. Quotes are removed; nothing is expanded or executed. */
export function parseEnv(text) {
  const values = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    values.set(match[1], value);
  }
  return values;
}

/** Why the file must not be used, or null. */
function refusal(home, path) {
  const info = lstatSync(path);
  if (!info.isFile()) return "`.env` is not a regular file (it may be a link). Secrets are read only from a file in the app's own folder.";
  if (info.size > ENV_LIMIT) return "`.env` is too large to be a list of secrets.";
  if (POSIX) {
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) return "`.env` belongs to another user of this computer.";
    if ((info.mode & 0o077) !== 0) return "`.env` can be read by other users of this computer. Make it yours alone: chmod 600 .env";
  }
  // Tracked or trackable by git is how secrets end up published.
  try {
    execFileSync("git", ["-c", "core.fsmonitor=false", "check-ignore", "-q", ".env"], { cwd: home, stdio: "ignore", timeout: 4000 });
  } catch (error) {
    if (error?.status === 1) return "`.env` is not ignored by git, so it could be committed and published. Add a line `.env` to .gitignore (and if it was already committed, change the secrets in it).";
    // 128: not a git repository. ENOENT: git is not installed. Either way there is nothing to protect against.
  }
  return null;
}

const cache = new Map();

/**
 * The secrets of a home: `{ secrets: Map<name, { value, hosts }>, problems: string[] }`.
 * Read again when the file changes, so an edit needs no restart.
 */
export function secretsOf(home) {
  const path = join(home, ".env");
  let info;
  try {
    info = lstatSync(path);
  } catch {
    cache.delete(home);
    return { secrets: new Map(), problems: [] };
  }
  const stamp = `${info.mtimeMs}:${info.size}:${info.mode}`;
  const cached = cache.get(home);
  // The git answer can change without the file changing, so a refusal is checked again each time.
  if (cached && cached.stamp === stamp && cached.problems.length === 0) return cached;
  const result = { stamp, secrets: new Map(), problems: [] };
  let why;
  try {
    why = refusal(home, path);
  } catch (error) {
    why = `\`.env\` could not be checked: ${error.message}`;
  }
  if (why) result.problems.push(why);
  else {
    const values = parseEnv(readFileSync(path, "utf8"));
    for (const [key, value] of values) {
      if (!key.startsWith(PREFIX) || key.endsWith("_HOSTS")) continue;
      const name = key.slice(PREFIX.length);
      if (!name) continue;
      const hosts = (values.get(`${key}_HOSTS`) ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
      if (!value) result.problems.push(`${key} is empty.`);
      else if (hosts.length === 0) result.problems.push(`${key} has no ${key}_HOSTS, so it cannot be sent anywhere. List the hosts it is for, for example ${key}_HOSTS=api.example.com`);
      else if (hosts.some((h) => !/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(h))) result.problems.push(`${key}_HOSTS must be host names separated by commas (a leading "*." allows subdomains).`);
      else result.secrets.set(name, { value, hosts });
    }
  }
  cache.set(home, result);
  return result;
}

const hostAllowed = (hostname, hosts) => hosts.some((h) => (h.startsWith("*.") ? hostname.endsWith(h.slice(1)) && hostname.length > h.length - 1 : hostname === h));
const isLoopback = (hostname) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

/**
 * The value of a secret for one request, or an error that says why not. The
 * address must be one of the secret's hosts, and encrypted unless it is this machine.
 */
export function secretFor(home, name, url) {
  if (!home) throw new Error("This page may not use the app's secrets. It must be served by the app's own dev server, with `bridgeProxy()` from @werkbank/bridge/vite in its Vite config.");
  if (typeof name !== "string" || !/^[A-Za-z0-9_]+$/.test(name)) throw new Error("A secret is referred to by its name.");
  const { secrets, problems } = secretsOf(home);
  const secret = secrets.get(name);
  if (!secret) throw new Error(problems[0] ?? `There is no secret called ${name}. Add ${PREFIX}${name} and ${PREFIX}${name}_HOSTS to the app's .env file.`);
  const hostname = url.hostname.toLowerCase();
  if (!hostAllowed(hostname, secret.hosts)) throw new Error(`The secret ${name} may not be sent to ${hostname}. It is for: ${secret.hosts.join(", ")}.`);
  if (url.protocol !== "https:" && !isLoopback(hostname)) throw new Error(`The secret ${name} is only sent over https.`);
  return secret.value;
}

/** Remove a secret's value from anything that goes back to the app. */
export function redact(value, secret) {
  if (!secret) return value;
  if (typeof value === "string") return value.split(secret).join("[secret]");
  if (Array.isArray(value)) return value.map((v) => redact(v, secret));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, secret)]));
  return value;
}

/** What the app may know about its home: that it has one, the names of its secrets, and what is wrong. Never a value. */
export function homeInfo(home) {
  if (!home) return { available: false, store: false, secrets: [], problems: [] };
  const { secrets, problems } = secretsOf(home);
  return { available: true, store: true, secrets: [...secrets].map(([name, s]) => ({ name, hosts: s.hosts })), problems };
}
