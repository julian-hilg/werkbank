/**
 * The dev-server side of the agent bridge: what an app puts in its Vite config
 * so the page reaches the bridge through its own address.
 *
 *   import { bridgeProxy } from "@werkbank/bridge/vite";
 *   export default defineConfig({ server: { port: 5200, strictPort: true, proxy: bridgeProxy() } });
 *
 * Besides forwarding, it tells the bridge which folder the app lives in (the
 * `x-werkbank-home` header). That is what lets the bridge keep the app's
 * conversations in `.werkbank/` there and use the secrets in its `.env`. A web
 * page cannot set this header itself, so only pages served by this dev server
 * get the folder. Pass `home: false` to an app that should have neither.
 */
import { homeAt, portOf } from "./config.js";

/**
 * @param {{ port?: number | string, home?: string | false, path?: string }} [options]
 *   port: the bridge's port (default: BRIDGE_PORT, or "werkbank": { "bridgePort" } in the app's package.json, or 8787).
 *         The bridge reads the same, so the two agree.
 *   home: the app's folder (default: where the dev server was started), or false for none.
 *   path: the address the page uses (default "/__bridge").
 */
export function bridgeProxy(options = {}) {
  const folder = homeAt(options.home || undefined);
  const port = options.port ?? portOf(folder);
  const home = options.home === false ? null : folder;
  return {
    [options.path ?? "/__bridge"]: {
      target: `ws://127.0.0.1:${port}`,
      ws: true,
      // The bridge checks that the page comes from this machine, and from this server: keep its Origin as it is.
      rewriteWsOrigin: false,
      ...(home ? { headers: { "x-werkbank-home": home } } : {}),
    },
  };
}
