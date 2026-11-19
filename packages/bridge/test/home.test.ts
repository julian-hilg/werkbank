// @ts-nocheck: the bridge is plain JavaScript.
import { spawn, execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { parseEnv, redact } from "../src/home.js";

/**
 * The bridge's handling of an app's folder: the files it keeps there and the
 * secrets it reads from `.env`. Run against the real server, over a real
 * WebSocket, with the headers a dev server would (or would not) send.
 */
const PORT = 8797;
const SECRET = "s3cr3t-value-that-must-never-leave";
const posix = process.platform !== "win32";
let bridge;
let echo;
let echoPort;
let seen = [];
let root;
/** The folder of the app the bridge under test belongs to. */
let own;

/** Open an app connection as a dev server would forward it, and return a function that calls a service. */
async function connect({ home, origin = "http://localhost:5200", host = "localhost:5200", port = PORT }: { home?: string; origin?: string; host?: string; port?: number } = {}) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`, { headers: { origin, host, ...(home ? { "x-werkbank-home": home } : {}) } });
  const waiting = new Map();
  let welcome;
  const ready = new Promise((resolve, reject) => {
    socket.on("error", reject);
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.welcome) return void resolve((welcome = message.welcome));
      if (message.service) waiting.get(message.service.id)?.(message.service.result);
    });
  });
  await ready;
  let next = 1;
  const call = (name: string, params: object = {}) =>
    new Promise<any>((resolve) => {
      const id = String(next++);
      waiting.set(id, resolve);
      socket.send(JSON.stringify({ service: { id, name, params } }));
    });
  return { call, welcome, close: () => socket.close() };
}

const makeHome = (name: string) => {
  const dir = join(root, name);
  mkdirSync(dir);
  return dir;
};
/** The app's folder as a new app has it: nothing kept, no secrets, not a repository. */
const cleanHome = () => {
  for (const entry of [".env", ".werkbank", ".git", ".gitignore"]) rmSync(join(own, entry), { recursive: true, force: true });
  return own;
};
const startBridge = (home: string, port = PORT) =>
  spawn(process.execPath, [fileURLToPath(new URL("../src/server.js", import.meta.url)), "--hub", "--home", home], {
    env: { ...process.env, BRIDGE_PORT: String(port), BRIDGE_AGENT: "fake", WERKBANK_SECRET_FROM_SHELL: "not-used" },
    stdio: ["ignore", "ignore", "pipe"],
  });
const writeEnv = (home: string, text: string, mode = 0o600) => {
  writeFileSync(join(home, ".env"), text);
  chmodSync(join(home, ".env"), mode);
};

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "werkbank-home-")));
  echo = createServer(async (req, res) => {
    let received = "";
    req.on("data", (chunk) => (received += chunk));
    await new Promise((resolve) => req.on("end", resolve));
    seen.push({ url: req.url, method: req.method, headers: req.headers, body: received });
    if (req.url === "/redirect") return void res.writeHead(302, { location: "http://example.com/elsewhere" }).end();
    res.writeHead(200, { "content-type": "application/json" });
    // An API that repeats the credential it was given, as some do in error messages.
    res.end(JSON.stringify({ youSent: req.headers.authorization ?? req.headers["x-api-key"] ?? null, nested: { again: `key=${req.headers["x-api-key"] ?? req.headers.authorization}` } }));
  });
  await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
  echoPort = echo.address().port;
  own = makeHome("app");
  bridge = startBridge(own);
  await new Promise<void>((resolve, reject) => {
    bridge.stderr.on("data", (chunk) => /hub:/.test(String(chunk)) && resolve());
    bridge.on("exit", () => reject(new Error("the bridge did not start")));
    setTimeout(() => reject(new Error("the bridge did not start in time")), 8000);
  });
});
afterAll(() => {
  bridge?.kill("SIGTERM");
  echo?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("which page may use the app's folder", () => {
  it("lets the app's own page in, through its own dev server", async () => {
    const app = await connect({ home: cleanHome() });
    expect(app.welcome).toMatchObject({ home: true, foreign: false });
    expect((await app.call("home.info")).value).toEqual({ available: true, store: true, secrets: [], problems: [] });
    app.close();
  });

  it("gives nothing to a connection that names no folder", async () => {
    cleanHome();
    const app = await connect();
    expect(app.welcome).toMatchObject({ home: false, foreign: false });
    expect((await app.call("home.info")).value).toEqual({ available: false, store: false, secrets: [], problems: [] });
    expect(await app.call("store.write", { name: "conversations", text: "{}" })).toMatchObject({ ok: false });
    expect(await app.call("store.read", { name: "conversations" })).toMatchObject({ ok: false });
    app.close();
  });

  it("gives nothing to a page that was not served by the dev server that forwarded it", async () => {
    const app = await connect({ home: cleanHome(), origin: "http://localhost:3000", host: "localhost:5200" });
    expect(app.welcome.home).toBe(false);
    expect(await app.call("store.write", { name: "conversations", text: "{}" })).toMatchObject({ ok: false });
    expect(existsSync(join(own, ".werkbank"))).toBe(false);
    app.close();
  });

  it("gives nothing to another app that was pointed at this bridge, and says so", async () => {
    cleanHome();
    writeEnv(own, `WERKBANK_SECRET_API=${SECRET}\nWERKBANK_SECRET_API_HOSTS=127.0.0.1\n`);
    const elsewhere = makeHome("another-app");
    const app = await connect({ home: elsewhere });
    expect(app.welcome).toMatchObject({ home: false, foreign: true });
    seen = [];
    expect(await app.call("http.get", { url: `http://127.0.0.1:${echoPort}/data`, auth: { secret: "API" } })).toMatchObject({ ok: false });
    expect(await app.call("store.write", { name: "conversations", text: "{}" })).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
    expect(existsSync(join(elsewhere, ".werkbank"))).toBe(false);
    expect(existsSync(join(own, ".werkbank"))).toBe(false);
    app.close();
  });

  it("refuses a page from another site outright", async () => {
    await expect(connect({ home: cleanHome(), origin: "https://example.com", host: "example.com" })).rejects.toThrow();
  });

  it("ignores a folder that is relative or does not exist", async () => {
    for (const home of ["relative/path", join(root, "missing")]) {
      const app = await connect({ home });
      expect(app.welcome.home).toBe(false);
      app.close();
    }
  });
});

describe("one bridge per app", () => {
  const outcome = (child) =>
    new Promise<{ code: number | null; said: string }>((resolve) => {
      let said = "";
      child.stderr.on("data", (chunk) => {
        said += String(chunk);
        if (/peer: forwarding/.test(said)) resolve({ code: null, said });
      });
      child.on("exit", (code) => resolve({ code, said }));
    });

  it("says which app it serves without revealing the folder", async () => {
    const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
    expect(health.home).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(health)).not.toContain(own);
  });

  it("stops a bridge of another app that was given the same port, with the way out", async () => {
    const other = startBridge(makeHome("second-app"));
    const { code, said } = await outcome(other);
    expect(code).toBe(1);
    expect(said).toMatch(/used by the bridge of another Werkbank app/);
    expect(said).toMatch(/"bridgePort"/);
  });

  it("lets a second copy for the same app join the first", async () => {
    const copy = startBridge(own);
    const { code, said } = await outcome(copy);
    copy.kill("SIGTERM");
    expect(code).toBe(null);
    expect(said).toMatch(/peer: forwarding/);
  });

  it("takes its port from the app's package.json", async () => {
    const home = makeHome("configured");
    writeFileSync(join(home, "package.json"), JSON.stringify({ name: "configured", werkbank: { bridgePort: PORT + 1 } }));
    const { BRIDGE_PORT: _unset, ...env } = process.env;
    const child = spawn(process.execPath, [fileURLToPath(new URL("../src/server.js", import.meta.url)), "--hub", "--home", home], { env, stdio: ["ignore", "ignore", "pipe"] });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stderr.on("data", (chunk) => /hub:/.test(String(chunk)) && resolve());
        setTimeout(() => reject(new Error("did not start")), 6000);
      });
      const app = await connect({ home, port: PORT + 1 });
      expect(app.welcome.home).toBe(true);
      app.close();
    } finally {
      child.kill("SIGTERM");
    }
  });
});

describe("files the app keeps", () => {
  it("writes and reads the conversations file, private to the user", async () => {
    const home = cleanHome();
    const app = await connect({ home });
    expect(app.welcome.home).toBe(true);
    expect((await app.call("store.read", { name: "conversations" })).value).toEqual({ text: null });
    const text = JSON.stringify({ version: 1, conversations: [], deleted: {} });
    expect(await app.call("store.write", { name: "conversations", text })).toMatchObject({ ok: true });
    expect((await app.call("store.read", { name: "conversations" })).value).toEqual({ text });
    expect(readFileSync(join(home, ".werkbank", "conversations.json"), "utf8")).toBe(text);
    expect(readFileSync(join(home, ".werkbank", ".gitignore"), "utf8")).toBe("*\n");
    if (posix) {
      expect(lstatSync(join(home, ".werkbank")).mode & 0o777).toBe(0o700);
      expect(lstatSync(join(home, ".werkbank", "conversations.json")).mode & 0o777).toBe(0o600);
    }
    app.close();
  });

  it("keeps only the files it knows, and only JSON", async () => {
    const home = cleanHome();
    const app = await connect({ home });
    for (const name of ["../../etc/passwd", "conversations.json", "__proto__", "constructor", ""]) {
      expect(await app.call("store.write", { name, text: "{}" })).toMatchObject({ ok: false });
      expect(await app.call("store.read", { name })).toMatchObject({ ok: false });
    }
    expect(await app.call("store.write", { name: "conversations", text: "not json" })).toMatchObject({ ok: false });
    expect(await app.call("store.write", { name: "conversations", text: { an: "object" } })).toMatchObject({ ok: false });
    expect(existsSync(join(home, ".werkbank", "conversations.json"))).toBe(false);
    app.close();
  });

  it.skipIf(!posix)("does not write through a link to somewhere else", async () => {
    const home = cleanHome();
    const elsewhere = makeHome("elsewhere");
    symlinkSync(elsewhere, join(home, ".werkbank"));
    const app = await connect({ home });
    expect(await app.call("store.write", { name: "conversations", text: "{}" })).toMatchObject({ ok: false });
    expect(existsSync(join(elsewhere, "conversations.json"))).toBe(false);
    app.close();
  });
});

describe("secrets", () => {
  const env = () => `# what this app may use\nWERKBANK_SECRET_API=${SECRET}\nWERKBANK_SECRET_API_HOSTS=127.0.0.1\nexport WERKBANK_SECRET_QUOTED="quoted value"\nWERKBANK_SECRET_QUOTED_HOSTS=*.example.org, api.example.com\nWERKBANK_SECRET_NOWHERE=abc\nOTHER_SETTING=visible-to-nobody\n`;

  it("tells the app the names and hosts, never a value", async () => {
    const home = cleanHome();
    writeEnv(home, env());
    const app = await connect({ home });
    const info = await app.call("home.info");
    expect(info.value.secrets).toEqual([{ name: "API", hosts: ["127.0.0.1"] }, { name: "QUOTED", hosts: ["*.example.org", "api.example.com"] }]);
    expect(info.value.problems.join(" ")).toMatch(/WERKBANK_SECRET_NOWHERE has no WERKBANK_SECRET_NOWHERE_HOSTS/);
    const everything = JSON.stringify(info);
    for (const value of [SECRET, "quoted value", "abc", "visible-to-nobody", "not-used"]) expect(everything).not.toContain(value);
    app.close();
  });

  it("attaches a secret to a request for one of its hosts, and removes it from the answer", async () => {
    const home = cleanHome();
    writeEnv(home, env());
    const app = await connect({ home });
    seen = [];
    const bearer = await app.call("http.get", { url: `http://127.0.0.1:${echoPort}/data`, auth: { secret: "API" } });
    expect(seen.at(-1).headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(bearer.ok).toBe(true);
    expect(JSON.stringify(bearer)).not.toContain(SECRET);
    expect(bearer.value.body.youSent).toBe("Bearer [secret]");
    const header = await app.call("http.get", { url: `http://127.0.0.1:${echoPort}/data`, auth: { secret: "API", as: "header", header: "X-Api-Key" } });
    expect(seen.at(-1).headers["x-api-key"]).toBe(SECRET);
    expect(seen.at(-1).headers.authorization).toBeUndefined();
    expect(JSON.stringify(header)).not.toContain(SECRET);
    expect(header.value.body.nested.again).toBe("key=[secret]");
    app.close();
  });

  it("does not send a secret to a host it is not for, over plain http, or along a redirect", async () => {
    const home = cleanHome();
    writeEnv(home, `${env()}WERKBANK_SECRET_PLAIN=${SECRET}\nWERKBANK_SECRET_PLAIN_HOSTS=example.com\n`);
    const app = await connect({ home });
    seen = [];
    const wrongHost = await app.call("http.get", { url: `http://localhost:${echoPort}/data`, auth: { secret: "API" } });
    expect(wrongHost).toMatchObject({ ok: false });
    expect(wrongHost.error).toMatch(/may not be sent to localhost/);
    expect(await app.call("http.get", { url: "http://example.com/", auth: { secret: "PLAIN" } })).toMatchObject({ ok: false, error: expect.stringMatching(/only sent over https/) });
    expect(await app.call("http.get", { url: `http://127.0.0.1:${echoPort}/data`, auth: { secret: "NOWHERE" } })).toMatchObject({ ok: false });
    expect(await app.call("http.get", { url: `http://127.0.0.1:${echoPort}/data`, auth: { secret: "MISSING" } })).toMatchObject({ ok: false });
    expect(await app.call("http.get", { url: `http://127.0.0.1:${echoPort}/data`, auth: { secret: "../API" } })).toMatchObject({ ok: false });
    expect(await app.call("http.get", { url: `http://127.0.0.1:${echoPort}/data`, auth: { secret: "API", as: "header", header: "bad header\r\nx: y" } })).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
    const redirected = await app.call("http.get", { url: `http://127.0.0.1:${echoPort}/redirect`, auth: { secret: "API" } });
    expect(redirected).toMatchObject({ ok: false, error: expect.stringMatching(/redirect/) });
    expect(seen.map((r) => r.url)).toEqual(["/redirect"]); // asked once, followed nowhere
    for (const result of [wrongHost, redirected]) expect(JSON.stringify(result)).not.toContain(SECRET);
    app.close();
  });

  it("sends a write with a secret, to its hosts only and never along a redirect", async () => {
    writeEnv(cleanHome(), env());
    const app = await connect({ home: own });
    seen = [];
    const posted = await app.call("http.request", { url: `http://127.0.0.1:${echoPort}/items`, method: "post", json: { name: "x" }, auth: { secret: "API" } });
    expect(posted.ok).toBe(true);
    expect(seen.at(-1)).toMatchObject({ method: "POST", url: "/items", body: '{"name":"x"}' });
    expect(seen.at(-1).headers["content-type"]).toBe("application/json");
    expect(seen.at(-1).headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.stringify(posted)).not.toContain(SECRET);
    const deleted = await app.call("http.request", { url: `http://127.0.0.1:${echoPort}/items/1`, method: "DELETE", body: "plain" });
    expect(seen.at(-1)).toMatchObject({ method: "DELETE", body: "plain" });
    expect(deleted.ok).toBe(true);
    seen = [];
    expect(await app.call("http.request", { url: `http://localhost:${echoPort}/items`, method: "POST", json: {}, auth: { secret: "API" } })).toMatchObject({ ok: false });
    expect(await app.call("http.request", { url: `http://127.0.0.1:${echoPort}/items`, method: "TRACE" })).toMatchObject({ ok: false });
    expect(await app.call("http.request", { url: `http://127.0.0.1:${echoPort}/items`, method: "POST", body: "x".repeat(1_000_001) })).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
    // A write is not followed to another address even without a secret.
    expect(await app.call("http.request", { url: `http://127.0.0.1:${echoPort}/redirect`, method: "POST", json: {} })).toMatchObject({ ok: false, error: expect.stringMatching(/redirect/) });
    expect(seen.map((r) => r.url)).toEqual(["/redirect"]);
    // And "http.get" stays a read, whatever it is told.
    seen = [];
    await app.call("http.get", { url: `http://127.0.0.1:${echoPort}/data`, method: "DELETE", body: "x" });
    expect(seen.at(-1)).toMatchObject({ method: "GET", body: "" });
    app.close();
  });

  it("gives a page without the folder no secret", async () => {
    writeEnv(cleanHome(), env());
    seen = [];
    const stranger = await connect();
    expect(await stranger.call("http.get", { url: `http://127.0.0.1:${echoPort}/data`, auth: { secret: "API" } })).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
    stranger.close();
  });

  it.skipIf(!posix)("uses no secret from a file others can read, or that is a link", async () => {
    const home = cleanHome();
    writeEnv(home, env(), 0o644);
    const app = await connect({ home });
    const loose = (await app.call("home.info")).value;
    expect(loose.secrets).toEqual([]);
    expect(loose.problems[0]).toMatch(/chmod 600 \.env/);
    expect(await app.call("http.get", { url: `http://127.0.0.1:${echoPort}/data`, auth: { secret: "API" } })).toMatchObject({ ok: false, error: expect.stringMatching(/chmod 600/) });
    // Fixing the file is enough; nothing needs restarting.
    chmodSync(join(home, ".env"), 0o600);
    expect((await app.call("home.info")).value.secrets).toHaveLength(2);
    app.close();

    const real = join(makeHome("secrets-link"), "real.env");
    writeFileSync(real, env(), { mode: 0o600 });
    rmSync(join(home, ".env"));
    symlinkSync(real, join(home, ".env"));
    const second = await connect({ home });
    expect((await second.call("home.info")).value).toMatchObject({ secrets: [], problems: [expect.stringMatching(/not a regular file/)] });
    second.close();
  });

  it("uses no secret from a file git could commit", async () => {
    const home = cleanHome();
    try {
      execFileSync("git", ["init", "-q"], { cwd: home, stdio: "ignore" });
    } catch {
      return; // no git here, nothing to check
    }
    writeEnv(home, env());
    const app = await connect({ home });
    const tracked = (await app.call("home.info")).value;
    expect(tracked.secrets).toEqual([]);
    expect(tracked.problems[0]).toMatch(/not ignored by git/);
    writeFileSync(join(home, ".gitignore"), ".env\n");
    expect((await app.call("home.info")).value.secrets).toHaveLength(2);
    app.close();
  });
});

describe("reading and hiding", () => {
  it("reads KEY=value lines without expanding or running anything", () => {
    const values = parseEnv(`# comment\nA=1\nexport B = two words \nC="quoted # not a comment"\nD='single'\nE=value # trailing comment\nF=$(whoami) \${HOME}\nnot a line\n=nokey\nG=\n`);
    expect(Object.fromEntries(values)).toEqual({ A: "1", B: "two words", C: "quoted # not a comment", D: "single", E: "value", F: "$(whoami) ${HOME}", G: "" });
  });

  it("removes a value wherever it appears in an answer", () => {
    expect(redact({ a: "x SECRET y", b: ["SECRET", 3, null], c: { d: "SECRETSECRET" } }, "SECRET")).toEqual({ a: "x [secret] y", b: ["[secret]", 3, null], c: { d: "[secret][secret]" } });
    expect(redact("unchanged", null)).toBe("unchanged");
  });
});
