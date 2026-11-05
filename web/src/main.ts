// Boot. The page paints at once from the recorded testnet deployment (labelled "Connecting to NEAR…"),
// and switches to the live site the moment /health or /claims answers; the checks keep retrying in
// the background. The site says "not live" only after two health checks in a row have failed.
// ?recorded=1 stays on the recording. The lane's key is requested as soon as the site is live, so the
// first tap is instant.
import { Api } from "./core/api";
import { loadConfig, ConfigError, type Config } from "./core/config";
import { Lane } from "./core/lane";
import { Router } from "./core/router";
import { createStore, type Store } from "./core/store";
import { AgentBook, TradeHistory, type Mode } from "./ui/context";
import { mountApp, type LinkStatus } from "./ui/app";

const root = document.getElementById("root")!;

/** One check: does /health or /claims answer (any answer that isn't a network failure)? */
async function answers(api: Api, ms: number): Promise<boolean> {
  const one = (p: Promise<{ ok: boolean; error?: { state: string } }>) => p.then((r) => r.ok || (r.error!.state !== "offline" && r.error!.state !== "timeout"));
  const t = new Promise<boolean>((res) => setTimeout(() => res(false), ms));
  return Promise.race([t, new Promise<boolean>((res) => {
    let left = 2;
    const done = (v: boolean) => { if (v) res(true); else if (--left === 0) res(false); };
    one(api.health() as any).then(done, () => done(false));
    one(api.allClaims() as any).then(done, () => done(false));
  })]);
}

/** Resolves once the page has loaded and the main thread is idle (at most a second after load). */
function settled(): Promise<void> {
  return new Promise((res) => {
    const idle = () => ((window as any).requestIdleCallback ? (window as any).requestIdleCallback(() => res(), { timeout: 1000 }) : setTimeout(res, 300));
    if (document.readyState === "complete") idle(); else addEventListener("load", idle, { once: true });
  });
}

interface Running { store: Store; mode: Mode; ui: { setStatus(s: LinkStatus): void } }

// The first sign of a person (a touch, a click, a key, a scroll), remembered across the switch from
// the recorded page to the live one. The free $1 key is asked for only after it: each key counts
// against the visitor address's daily allowance, so previews and crawlers must not spend one.
let personSeen = false;
for (const ev of ["pointerdown", "touchstart", "keydown", "wheel", "scroll"]) window.addEventListener(ev, () => { personSeen = true; }, { capture: true, passive: true, once: true });

async function startRecorded(config: Config, router: Router, card: boolean, status: LinkStatus): Promise<Running> {
  const rec = await import("./ui/recorded");
  const api = new Api({ baseUrl: "http://recorded", fetch: rec.recordedFetch });
  const lane = rec.recordedLane();
  const store = createStore({ api, lane, config });
  const ui = mountApp(root, { store, api, config, router, mode: "recorded", card, recordedDate: rec.recordedDate(), history: new TradeHistory(), agents: new AgentBook() }, status);
  void store.open(router.route);
  // a rehearsed doubt on a line of the recorded paragraph plays the rewrite NEAR AI Cloud really signed for it on testnet
  const rw = rec.RECORDED.rewrite;
  let played = "";
  store.subscribe((s) => {
    const c = s.doubt.ctx;
    if (s.doubt.stage !== "final" || !c || c.claimId === null || s.page.slug !== rw.page) return;
    if (!rw.sentences.some((x: { claim_id: number }) => x.claim_id === c.claimId) || played === c.key + c.startedAt) return;
    played = c.key + c.startedAt;
    setTimeout(() => store.ingest({ seq: 1e9, uid: `recorded-rewrite-${played}`, event: "rewrite", source: "ai", data: { ...rw, createdAt: Date.now() } }), 400);
  });
  (window as any).__pricedin = { store, router, lane, config, mode: "recorded" };
  return { store, mode: "recorded", ui };
}

function startLive(config: Config, api: Api, router: Router, card: boolean): Running {
  const lane = new Lane({ api, config });
  // the store and the trade history both read /events/recent at load: one request serves both
  const recent = api.recentEvents.bind(api);
  let shared: { since: number; at: number; p: ReturnType<typeof recent> } | null = null;
  api.recentEvents = (since = 0) => {
    if (shared && shared.since === since && Date.now() - shared.at < 3000) return shared.p;
    shared = { since, at: Date.now(), p: recent(since) };
    return shared.p;
  };
  // the live stream connects once the page has painted and gone idle
  const stream = api.stream.bind(api);
  api.stream = (path: string, signal: AbortSignal) => settled().then(() => stream(path, signal));
  const store = createStore({ api, lane, config, warmOn: window });
  if (personSeen) void lane.prepare(); // someone already touched the recorded page
  const ui = mountApp(root, { store, api, config, router, mode: "live", card, recordedDate: null, history: new TradeHistory(), agents: new AgentBook() }, "live");
  void store.open(router.route);
  (window as any).__pricedin = { store, router, lane, config, mode: "live" };
  return { store, mode: "live", ui };
}

async function boot() {
  const config = loadConfig();
  const q = new URLSearchParams(location.search);
  const card = q.has("card");
  const router = new Router(window);
  let cur: Running | null = null;
  router.subscribe((r) => { if (cur) void cur.store.open(r); });
  const api = new Api({ baseUrl: config.apiBase });

  if (q.has("recorded") || q.has("demo")) { cur = await startRecorded(config, router, card, "recorded"); return; }

  // the first check gets a moment before anything paints, so a fast API never flashes the recording
  const first = answers(api, 6000);
  const quick = await Promise.race([first, new Promise<"slow">((r) => setTimeout(() => r("slow"), 900))]);
  if (quick === true) { cur = startLive(config, api, router, card); return; }
  cur = await startRecorded(config, router, card, "connecting");

  let fails = quick === false ? 1 : 0;
  let ok = quick === "slow" ? await first : false;
  if (quick === "slow" && !ok) fails = 1;
  while (!ok) {
    if (fails >= 2) cur.ui.setStatus("recorded");
    await new Promise((r) => setTimeout(r, fails ? 5000 : 0));
    ok = await answers(api, 6000);
    if (!ok) fails++;
  }
  // live: switch once no rehearsed bet is on its way
  const wait = () => new Promise<void>((res) => {
    const busy = () => ["quoting", "signing", "optimistic"].includes(cur!.store.state.doubt.stage);
    if (!busy()) return res();
    const off = cur!.store.subscribe(() => { if (!busy()) { off(); res(); } });
  });
  await wait();
  const y = window.scrollY;
  cur.store.close();
  cur = startLive(config, api, router, card);
  requestAnimationFrame(() => window.scrollTo(0, y));
}

boot().catch((e) => {
  root.textContent = e instanceof ConfigError ? `This build is misconfigured: ${e.message}` : `Priced In failed to start: ${(e as Error).message}`;
});
