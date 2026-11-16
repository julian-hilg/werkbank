import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "@werkbank/framework";
import "@werkbank/framework/styles.css";
import "./tools/tools.css";
import "./tools/showcase.css";
import { werkbank } from "./app";
import { FeedStatus } from "./FeedStatus";
import { connections } from "./data/connections";
import { feed } from "./market/feed";
import { ledger } from "./portfolio/ledger";
import { tasks } from "./tasks/store";

// Handles for tests and for poking at the app from the browser console.
Object.assign(window, { werkbank, feed, ledger, tasks, connections });

// The agent bridge is reached through this page's own address (the dev server
// forwards it). Override for one page load with ?bridge=ws://127.0.0.1:9000
const bridgeUrl =
  new URLSearchParams(location.search).get("bridge") ??
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__bridge`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell werkbank={werkbank} status={<FeedStatus />} bridgeUrl={bridgeUrl} />
  </StrictMode>,
);
