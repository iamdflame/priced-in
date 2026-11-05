// Boot: config, the API client, the lane (its key is requested now, so the first tap is
// instant), the store and the router. The shell is temporary; the design mounts here instead.
import { Api } from "./core/api";
import { loadConfig, ConfigError } from "./core/config";
import { Lane } from "./core/lane";
import { Router } from "./core/router";
import { createStore } from "./core/store";
import { mountShell } from "./shell/shell";

const root = document.getElementById("root")!;
try {
  const config = loadConfig();
  const api = new Api({ baseUrl: config.apiBase });
  const lane = new Lane({ api, config });
  const store = createStore({ api, lane, config });
  const router = new Router(window);
  router.subscribe((r) => void store.open(r));
  mountShell(root, store, router);
  void store.open(router.route);
  (window as any).__pricedin = { store, router, lane, config };
} catch (e) {
  root.textContent = e instanceof ConfigError ? `This build is misconfigured: ${e.message}` : `Priced In failed to start: ${(e as Error).message}`;
}
