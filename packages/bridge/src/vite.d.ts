/** Proxy settings for an app's Vite dev server: forwards the page's bridge connection and names the app's folder. */
export declare function bridgeProxy(options?: {
  /** The bridge's port. Default: the BRIDGE_PORT environment variable, or `"werkbank": { "bridgePort" }` in the app's package.json, or 8787. */
  port?: number | string;
  /** The app's folder, where `.werkbank/` and `.env` live. Default: where the dev server was started. `false` for none. */
  home?: string | false;
  /** The address the page uses. Default "/__bridge". */
  path?: string;
}): Record<string, { target: string; ws: true; rewriteWsOrigin: false; headers?: Record<string, string> }>;
