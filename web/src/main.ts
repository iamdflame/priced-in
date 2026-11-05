// Boot: config, the API client, the lane (its key is requested now, so the first tap is
// instant), the store, the router and the site. When the API can't be reached (or ?recorded=1),
// the site runs on the recorded testnet deployment instead, labelled as recorded everywhere.
import { Api } from "./core/api";
import { loadConfig, ConfigError } from "./core/config";
import { Lane } from "./core/lane";
import { Router } from "./core/router";
import { createStore } from "./core/store";
import { AgentBook, TradeHistory, type Mode } from "./ui/context";
import { mountApp } from "./ui/app";

const root = document.getElementById("root")!;

async function reachable(api: Api): Promise<boolean> {
  const r = await Promise.race([api.health(), new Promise<null>((res) => setTimeout(() => res(null), 3500))]);
  return !!r && (r.ok || (r.error.state !== "offline" && r.error.state !== "timeout"));
}

/** Resolves once the page has loaded and the main thread is idle (at most a second after load). */
function settled(): Promise<void> {
  return new Promise((res) => {
    const idle = () => ((window as any).requestIdleCallback ? (window as any).requestIdleCallback(() => res(), { timeout: 1000 }) : setTimeout(res, 300));
    if (document.readyState === "complete") idle(); else addEventListener("load", idle, { once: true });
  });
}

async function boot() {
  const config = loadConfig();
  const q = new URLSearchParams(location.search);
  const card = q.has("card");
  let api = new Api({ baseUrl: config.apiBase });
  let mode: Mode = q.has("recorded") || q.has("demo") ? "recorded" : (await reachable(api)) ? "live" : "recorded";
  let lane: Lane;
  let recordedDate: string | null = null;
  if (mode === "recorded") {
    const rec = await import("./ui/recorded");
    api = new Api({ baseUrl: "http://recorded", fetch: rec.recordedFetch });
    lane = rec.recordedLane();
    recordedDate = rec.recordedDate();
  } else {
    lane = new Lane({ api, config });
    // the live stream connects once the page has painted and gone idle: the first screen never waits on it
    // the store and the trade history both read /events/recent at load: one request serves both
    const recent = api.recentEvents.bind(api);
    let shared: { since: number; at: number; p: ReturnType<typeof recent> } | null = null;
    api.recentEvents = (since = 0) => {
      if (shared && shared.since === since && Date.now() - shared.at < 3000) return shared.p;
      shared = { since, at: Date.now(), p: recent(since) };
      return shared.p;
    };
    const stream = api.stream.bind(api);
    api.stream = (path: string, signal: AbortSignal) => settled().then(() => stream(path, signal));
  }
  const store = createStore({ api, lane, config });
  const router = new Router(window);
  router.subscribe((r) => void store.open(r));
  mountApp(root, { store, api, config, router, mode, card, recordedDate, history: new TradeHistory(), agents: new AgentBook() });
  void store.open(router.route);
  (window as any).__pricedin = { store, router, lane, config, mode };
}

boot().catch((e) => {
  root.textContent = e instanceof ConfigError ? `This build is misconfigured: ${e.message}` : `Priced In failed to start: ${(e as Error).message}`;
});
