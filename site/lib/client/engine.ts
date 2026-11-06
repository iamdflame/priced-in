// The browser's engine: the proven core wired for this site, one per tab. Load this module with a
// dynamic import, on a person's first move: it brings near-api-js, which no page needs just to read.
//   liveEngine: the API through this site's own /api rewrite, polled (the hosted API keeps no long-
//     running stream), and the lane (the free $1 key made in this browser).
//   recordedEngine: the same store over the replay of the complete mainnet run.
import { Api } from "../core/api";
import { loadConfig, type Config } from "../core/config";
import { Lane } from "../core/lane";
import { createStore, type Store } from "../core/store";
import { filming } from "./film";

export interface Engine {
  store: Store;
  lane: Lane;
  /** Ask for the free $1 key: a person picked a side. A no-op in the replay. */
  warm(): void;
}

const config = (): Config => loadConfig({
  VITE_NEAR_NETWORK: process.env.NEXT_PUBLIC_NEAR_NETWORK || "mainnet",
  VITE_API_BASE: "/api",
  VITE_DOUBT_MICRO: "1000000",
  VITE_DEFAULT_B_MICRO: "1450000",
});

let live: Engine | null = null;
let recorded: Promise<Engine> | null = null;

export function liveEngine(): Engine {
  if (live) return live;
  const cfg = config();
  const api = new Api({ baseUrl: "/api", live: "poll" });
  const lane = new Lane({ api, config: cfg });
  // the store asks for the key on the first "pointerdown" here, and only warm() dispatches one: each
  // key costs the lane gas, so page views, crawlers and screenshot runs never spend one
  const intent = new EventTarget();
  const store = createStore({ api, lane, config: cfg, warmOn: intent });
  // film mode asks for no key at all: the lane hears "unavailable" instead of calling /lane/key
  if (filming()) api.laneKey = async () => ({ ok: false, error: { state: "unavailable", code: "film_mode", message: "Film mode sends nothing.", status: 0, retryable: false } });
  live = { store, lane, warm: () => { if (!filming()) intent.dispatchEvent(new Event("pointerdown")); } };
  return live;
}

export function recordedEngine(): Promise<Engine> {
  recorded ??= import("../replay/engine").then(({ makeReplay }) => {
    const cfg = config();
    const { api, lane, attach } = makeReplay((fetchFn) => new Api({ baseUrl: "http://recorded", fetch: fetchFn, live: "poll" }), cfg);
    const store = createStore({ api, lane, config: cfg, stream: false });
    attach(store);
    return { store, lane, warm: () => {} };
  });
  return recorded;
}
