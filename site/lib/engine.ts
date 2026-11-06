"use client";
// The browser's engine: the proven core (web/src/core) wired for this site. One per tab, made on
// first use. Live: the API through this site's own /api rewrite, polled (the hosted API has no
// long-running stream), and the lane (the free $1 key made in this browser). Recorded (?recorded=1):
// the same store over a replay of the complete mainnet run in deployments/rehearsal/mainnet.json.
import { Api } from "./core/api";
import { loadConfig, type Config } from "./core/config";
import { Lane } from "./core/lane";
import { createStore, type Store } from "./core/store";

export type Mode = "live" | "recorded";

export interface Engine {
  mode: Mode;
  config: Config;
  api: Api;
  lane: Lane;
  store: Store;
}

let live: Engine | null = null;
// The store asks for the free $1 key on the first "pointerdown" here. Nothing dispatches one until a
// person picks Yes or No (warmLane), so page views, crawlers and screenshot runs never spend a key.
const intent = typeof EventTarget !== "undefined" ? new EventTarget() : null;
export function warmLane() { intent?.dispatchEvent(new Event("pointerdown")); }
let recorded: Promise<Engine> | null = null;

export function siteConfig(): Config {
  return loadConfig({
    VITE_NEAR_NETWORK: process.env.NEXT_PUBLIC_NEAR_NETWORK || "mainnet",
    VITE_API_BASE: "/api",
    VITE_DOUBT_MICRO: "1000000",
    VITE_DEFAULT_B_MICRO: "1450000",
  });
}

/** The live engine. Each free $1 key costs the lane gas, so it is asked for only after warmLane(). */
export function liveEngine(): Engine {
  if (live) return live;
  const config = siteConfig();
  const api = new Api({ baseUrl: "/api", live: "poll" });
  const lane = new Lane({ api, config });
  const store = createStore({ api, lane, config, warmOn: intent });
  live = { mode: "live", config, api, lane, store };
  if (typeof window !== "undefined") (window as any).__pricedin = live;
  return live;
}

export function recordedEngine(): Promise<Engine> {
  if (!recorded) {
    recorded = import("./recorded").then(({ makeRecorded }) => {
      const config = siteConfig();
      const r = makeRecorded();
      const api = new Api({ baseUrl: "http://recorded", fetch: r.fetch, live: "poll" });
      const store = createStore({ api, lane: r.lane, config, stream: false });
      r.attach(store);
      const e: Engine = { mode: "recorded", config, api, lane: r.lane, store };
      if (typeof window !== "undefined") (window as any).__pricedin = e;
      return e;
    });
  }
  return recorded;
}

/** Ask for the free $1 key now: a person tapped Yes or No somewhere and is on their way to the ticket. */
export const INTENT_KEY = "pricedin.intent";
export function markIntent() {
  try { sessionStorage.setItem(INTENT_KEY, String(Date.now())); } catch { /* private mode */ }
}
export function hadIntent(): boolean {
  try {
    const t = Number(sessionStorage.getItem(INTENT_KEY) || 0);
    sessionStorage.removeItem(INTENT_KEY);
    return Date.now() - t < 60_000;
  } catch { return false; }
}
