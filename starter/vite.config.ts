import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const BRIDGE = `ws://127.0.0.1:${process.env.BRIDGE_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  // Inside this repository the app runs on the framework's source, so edits to it show at once.
  resolve: { conditions: ["werkbank-source"] },
  server: {
    port: 5199,
    strictPort: true,
    // The app reaches the agent bridge through its own address, so the browser
    // sees one origin and has nothing to block.
    proxy: { "/__bridge": { target: BRIDGE, ws: true, rewriteWsOrigin: false } },
  },
});
