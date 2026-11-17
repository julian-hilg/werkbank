#!/usr/bin/env node
// The two processes of a Werkbank app in development: the app's dev server (frontend) and the agent bridge (backend).
//   node dev.mjs status [app folder]    what answers on the two ports, and which process holds them
//   node dev.mjs stop [app folder]      stop the ones that belong to this project (--force: whoever holds the ports)
// Start them with "npm run dev" in the app; this script never starts anything.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const [action = "status", folder = "."] = args.filter((a) => !a.startsWith("--"));
if (!["status", "stop"].includes(action)) {
  console.error("Usage: node dev.mjs status|stop [app folder] [--force]");
  process.exit(2);
}
const project = resolve(folder);
const appRoot = [project, join(project, "starter")].find((dir) => existsSync(join(dir, "src", "app.ts"))) ?? project;
const config = ["ts", "js", "mjs"].map((ext) => join(appRoot, `vite.config.${ext}`)).find(existsSync);
const appPort = Number((config && /\bport:\s*(\d+)/.exec(readFileSync(config, "utf8"))?.[1]) ?? 5173);
const bridgePort = Number(process.env.BRIDGE_PORT ?? 8787);

const get = async (url) => {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(1500) });
  } catch {
    return null;
  }
};
const quiet = (command, commandArgs) => {
  try {
    return execFileSync(command, commandArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const canInspect = process.platform !== "win32";
/** The processes listening on a port, each with the folder it was started in. */
const holders = (port) =>
  !canInspect
    ? []
    : quiet("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"])
        .split("\n")
        .filter(Boolean)
        .map((pid) => {
          let cwd = quiet("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"]).split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? "";
          if (!cwd) try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { /* unknown */ }
          return { pid: Number(pid), cwd, ours: cwd === project || cwd.startsWith(project + sep) };
        });
const describe = (list) => list.map((h) => `pid ${h.pid} from ${h.cwd || "an unknown folder"}${h.ours ? "" : " (another project)"}`).join(", ");

async function status() {
  const page = (await get(`http://127.0.0.1:${appPort}/`)) ?? (await get(`http://[::1]:${appPort}/`));
  const health = await get(`http://127.0.0.1:${bridgePort}/health`);
  const bridge = health?.ok ? await health.json().catch(() => null) : null;
  const isBridge = bridge?.name === "werkbank-bridge";
  const appHolders = holders(appPort);
  const bridgeHolders = holders(bridgePort);
  console.log(`frontend  http://localhost:${appPort}  ${page ? "answering" : "not running"}${appHolders.length ? `  [${describe(appHolders)}]` : ""}`);
  console.log(
    `backend   127.0.0.1:${bridgePort}  ${isBridge ? `bridge ${bridge.version} answering, ${bridge.apps.length ? `connected to: ${bridge.apps.join(", ")}` : "no app tab connected yet"}` : health ? "something else is using this port" : "not running"}${bridgeHolders.length ? `  [${describe(bridgeHolders)}]` : ""}`,
  );
  // One bridge serves every Werkbank app on the machine: whoever started first holds the port, and that is fine.
  const sharedBridge = isBridge && bridgeHolders.some((h) => !h.ours);
  if (sharedBridge) console.log("The bridge was started by another Werkbank app and is shared; this app uses it too.");
  if (appHolders.some((h) => !h.ours)) console.log(`Port ${appPort} is held by another project. Stop it there, or run: node ${process.argv[1]} stop --force`);
  else if (health && !isBridge) console.log(`Port ${bridgePort} is used by something that is not the bridge. Free it, or set BRIDGE_PORT.`);
  else if (!page) console.log('Start the app with "npm run dev" in its folder, as a background task.');
  else if (!isBridge) console.log('The app runs without its bridge, so no agent can reach it. Stop it and start both with "npm run dev".');
  else if (!bridge.apps.length) console.log("Open the app in a browser so the bridge has a tab to act on.");
  return page && isBridge ? 0 : 1;
}

async function stop() {
  if (!canInspect) {
    console.log('On Windows, close the terminal that runs "npm run dev" (or end its node processes in Task Manager).');
    return 1;
  }
  const all = [...holders(appPort), ...holders(bridgePort)];
  const targets = all.filter((h) => h.ours || force);
  for (const h of all.filter((x) => !targets.includes(x))) console.log(`Left running: pid ${h.pid} from ${h.cwd || "an unknown folder"} belongs to another project (a bridge is shared between apps). Use --force to stop it too.`);
  if (!targets.length && !all.length) console.log("Nothing is running on either port.");
  for (const h of targets) {
    try {
      process.kill(h.pid, "SIGTERM");
      console.log(`Stopped pid ${h.pid}.`);
    } catch (error) {
      console.log(`Could not stop pid ${h.pid}: ${error.message}`);
    }
  }
  // "npm run dev" stops the other process when one exits; give it a moment, then say what is left.
  for (let i = 0; i < 20 && [...holders(appPort), ...holders(bridgePort)].some((h) => h.ours || force); i++) await new Promise((r) => setTimeout(r, 150));
  const left = [...holders(appPort), ...holders(bridgePort)];
  console.log(left.length ? `Still listening: ${describe(left)}.` : `Ports ${appPort} and ${bridgePort} are free.`);
  return left.some((h) => h.ours || force) ? 1 : 0;
}

process.exit(await (action === "stop" ? stop() : status()));
