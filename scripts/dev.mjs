// Starts the app and the agent bridge together: npm run dev
// The bridge is what the in-app assistant and external agents connect through.
import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["packages/bridge/src/server.js", "--hub"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "starter"], { stdio: "inherit" }),
];
const stop = () => children.forEach((child) => child.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// If either one exits, stop the other so nothing is left running.
children.forEach((child) => child.on("exit", (code) => (stop(), process.exit(code ?? 0))));
