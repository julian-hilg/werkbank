import react from "@vitejs/plugin-react";
import { bridgeProxy } from "@werkbank/bridge/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Inside this repository the app runs on the framework's source, so edits to it show at once.
  resolve: { conditions: ["werkbank-source"] },
  server: {
    port: 5199,
    strictPort: true,
    // The app reaches the agent bridge through its own address, so the browser sees one origin and has
    // nothing to block. The proxy also tells the bridge which folder this app lives in: that is where
    // its conversations are kept (.werkbank/) and where its secrets are read from (.env).
    proxy: bridgeProxy(),
  },
});
