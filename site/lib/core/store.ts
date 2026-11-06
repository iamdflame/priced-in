// Copied unchanged from web/src/core/store.ts (the proven engine), except defaultLoadAudit below.
// Page state, live updates, and the doubt flow as an explicit state machine.
//
// The doubt machine (doubtReducer) is pure:
//   idle -> quoting -> signing -> optimistic -> final -> rewritten -> answered
//   and failed (with a reason) from quoting, signing or optimistic.
// A rewrite or an agent's answer that arrives before "final" is kept and applied the moment
// the bet is final, so the stages always read in order. The ink moves at "quoting" from the
// client-side LMSR quote, is replaced by the chain's price at "optimistic", and is rolled
// back if the bet fails.

import type { Api, ApiFailure, Claim, LiveStatus, MarketEvent, Notice, PlannedSentence, PostInfo, Rationale, Rewrite, DiffOp, Provenance } from "./api";
import type { EventStream, PollingEventStream } from "./api";
import type { Config } from "./config";
import { laneFailure, type Lane, type LaneFailureReason, type LaneState, type Trade } from "./lane";
import { costToMove, impliedBMicro, marketFromPrice, marketFromReceipt, quoteBuy, type BuyQuote, type Market, type Side } from "./lmsr";
import type { Route } from "./router";
import { NearRpc, eventsInOutcome } from "./rpc";
import { anchorFromEvents, verifyRewrite, type VerifyResult } from "./verify";

// ---------- sentences ----------

export type SentenceStatus =
  | "open" // a market exists and trades
  | "unopened" // priceable, the planner signed its opening price; the first bet opens it
  | "challenged" // a challenge is live: the jury is ruling or the dispute window runs
  | "settled" // resolved: shows the outcome, no more trading
  | "greyed" // opinion, about a person, written to a model: never priced
  | "pricing_soon" // the planner is offline
  | "unpriceable"; // too long or unlabelled

export interface Mover {
  trader: string;
  side: string;
  amountUsd: number;
  priceAfter: number;
  at: number;
  txHash?: string;
  mine: boolean;
  agent?: string;
  sourceUrl?: string | null;
}

export interface SentenceRewrite {
  id: string;
  version: number;
  status: Provenance["status"];
  signed: boolean;
  model: string | null;
  diff: DiffOp[] | null;
  paragraph: number;
}

export interface Sentence {
  key: string;
  index: number;
  paragraph: number;
  /** the wording shown now (a rewrite's wins) */
  text: string;
  /** the claim as written */
  original: string;
  claimId: number | null;
  kind: string | null;
  status: SentenceStatus;
  reason: string | null;
  chainPpm: number | null;
  /** the client-side quote's price while a bet is on its way */
  optimisticPpm: number | null;
  bMicro: bigint | null;
  trades: number;
  volumeUsd: number;
  outcome: boolean | null;
  provisional: boolean | null;
  receipt: PlannedSentence["receipt"] | null;
  source: { url: string; title: string | null; agent: string } | null;
  movers: Mover[];
  rewrite: SentenceRewrite | null;
}

/** Ink: price 0..1 to the GRAD axis (the heroes' mapping in .apex/design/exec/shared/kit.js). */
export const inkGrad = (p: number) => Math.round(-400 + 800 * Math.pow(Math.min(1, Math.max(0, p)), 0.9));

export const priceOf = (s: Sentence): number | null => {
  const ppm = s.optimisticPpm ?? s.chainPpm;
  return ppm === null ? null : ppm / 1e6;
};

export const priceable = (s: Sentence) => s.status === "open" || s.status === "unopened" || s.status === "challenged";

/** The market this sentence trades on, rebuilt from what the page knows. */
export function marketOf(s: Sentence, defaultBMicro: bigint): Market | null {
  if (s.chainPpm === null) return null;
  const b = s.bMicro ?? defaultBMicro;
  if (s.status === "unopened" && s.receipt) return marketFromReceipt(s.receipt.args.p0_ppm, s.receipt.args.b_micro);
  return marketFromPrice(s.optimisticPpm ?? s.chainPpm, b);
}

/** "costs $X to move 10 points", both ways. */
export function costToMove10(s: Sentence, defaultBMicro: bigint): { upUsd: number; downUsd: number } | null {
  const m = marketOf(s, defaultBMicro);
  return m ? costToMove(m, 10) : null;
}

export function inkOf(s: Sentence): number | null {
  const p = priceOf(s);
  return p === null ? null : inkGrad(p);
}

function fromClaim(c: Claim, index: number): Sentence {
  const b = impliedBMicro(c.price_yes_ppm / 1e6, Number(c.cost_up_10_micro), Number(c.cost_down_10_micro));
  const status: SentenceStatus = c.status === "Settled" ? "settled" : c.status === "Open" ? "open" : "challenged";
  return {
    key: `c${c.id}`, index, paragraph: 0, text: c.text, original: c.text, claimId: c.id, kind: c.kind, status,
    reason: status === "settled" ? `Settled ${c.outcome ? "true" : "false"}.` : null,
    chainPpm: c.price_yes_ppm, optimisticPpm: null, bMicro: b ? BigInt(b) : null, trades: c.trades, volumeUsd: c.volume_usd ?? Number(c.volume_micro) / 1e6,
    outcome: c.outcome, provisional: c.provisional, receipt: null, source: null, movers: [], rewrite: null,
  };
}

const GREY = new Set(["unfalsifiable", "about_a_person", "person"]);

function fromPlanned(p: PlannedSentence, i: number): Sentence {
  if (p.status === "listed" && p.claim) return { ...fromClaim(p.claim, i), key: `c${p.claim.id}` };
  const base: Sentence = {
    key: `s${p.index}`, index: i, paragraph: 0, text: p.text, original: p.text, claimId: null, kind: p.kind ?? null, status: "unpriceable",
    reason: p.reason ?? null, chainPpm: null, optimisticPpm: null, bMicro: null, trades: 0, volumeUsd: 0, outcome: null, provisional: null,
    receipt: null, source: null, movers: [], rewrite: null,
  };
  if (p.status === "priced" && p.receipt) return { ...base, status: "unopened", chainPpm: p.receipt.args.p0_ppm, bMicro: BigInt(p.receipt.args.b_micro), receipt: p.receipt };
  if (GREY.has(p.status)) return { ...base, status: "greyed", reason: p.reason ?? "Not priced." };
  if (p.status === "pricing_soon") return { ...base, status: "pricing_soon", reason: "Pricing soon: the planner is offline." };
  return base;
}

// ---------- the doubt machine ----------

export type DoubtStage = "idle" | "quoting" | "signing" | "optimistic" | "final" | "rewritten" | "answered" | "failed";

export type DoubtFailureReason = LaneFailureReason | "unpriced" | "overflow" | "busy";

export interface DoubtFailure {
  reason: DoubtFailureReason;
  message: string;
  retryable: boolean;
  readOnly: boolean;
  /** the stage it failed in */
  at: DoubtStage;
}

export interface DoubtCtx {
  key: string;
  claimId: number | null;
  side: Side;
  amountMicro: bigint;
  startedAt: number;
  priceBefore: number | null;
  quote: BuyQuote | null;
  waitingFor: "lane" | null;
  txHash: string | null;
  trade: Trade | null;
  rewrite: Rewrite | null;
  answer: Rationale | null;
  /** final was slow to confirm; the bet executed */
  finalNote: string | null;
  t: Partial<Record<DoubtStage, number>>;
}

export interface DoubtState {
  stage: DoubtStage;
  ctx: DoubtCtx | null;
  failure: DoubtFailure | null;
}

export type DoubtEvent =
  | { type: "start"; key: string; claimId: number | null; side: Side; amountMicro: bigint; priceBefore: number | null; at: number }
  | { type: "quoted"; quote: BuyQuote; at: number }
  | { type: "waiting"; for: "lane" }
  | { type: "signing"; at: number }
  | { type: "optimistic"; txHash: string; trade: Trade | null; at: number }
  | { type: "final"; trade: Trade | null; at: number }
  | { type: "final_late"; note: string }
  | { type: "rewrite"; rewrite: Rewrite; at: number }
  | { type: "answer"; rationale: Rationale; at: number }
  | { type: "fail"; reason: DoubtFailureReason; message?: string; retryable?: boolean; readOnly?: boolean; at: number }
  | { type: "reset" };

export const IDLE: DoubtState = { stage: "idle", ctx: null, failure: null };
const IN_FLIGHT: Set<DoubtStage> = new Set(["quoting", "signing", "optimistic"]);
/** The stages in the order a doubt passes them. */
export const DOUBT_ORDER: DoubtStage[] = ["idle", "quoting", "signing", "optimistic", "final", "rewritten", "answered"];

/** True while a doubt is on its way (a second tap is ignored). */
export const doubtBusy = (s: DoubtState) => IN_FLIGHT.has(s.stage);

/** Plain words for every failure the machine can end in. */
export function doubtFailure(reason: DoubtFailureReason, at: DoubtStage, o: { message?: string; retryable?: boolean; readOnly?: boolean } = {}): DoubtFailure {
  if (reason === "unpriced") return { reason, at, message: o.message ?? "Nothing to bet on here: this line isn't priced.", retryable: false, readOnly: true };
  if (reason === "overflow") return { reason, at, message: o.message ?? "That bet is too large for this sentence's market.", retryable: false, readOnly: false };
  if (reason === "busy") return { reason, at, message: o.message ?? "Your last bet is still on its way.", retryable: true, readOnly: false };
  const f = laneFailure(reason, { message: o.message });
  return { reason, at, message: f.message, retryable: o.retryable ?? f.retryable, readOnly: o.readOnly ?? f.readOnly };
}

export function doubtReducer(s: DoubtState, e: DoubtEvent): DoubtState {
  switch (e.type) {
    case "reset":
      return doubtBusy(s) ? s : IDLE;
    case "start":
      if (doubtBusy(s)) return s;
      return {
        stage: "quoting", failure: null,
        ctx: { key: e.key, claimId: e.claimId, side: e.side, amountMicro: e.amountMicro, startedAt: e.at, priceBefore: e.priceBefore, quote: null, waitingFor: null, txHash: null, trade: null, rewrite: null, answer: null, finalNote: null, t: { quoting: e.at } },
      };
    case "fail":
      if (!IN_FLIGHT.has(s.stage) && s.stage !== "idle") return s; // a bet that executed can't fail afterwards
      return { stage: "failed", ctx: s.ctx, failure: doubtFailure(e.reason, s.stage, e) };
  }
  const ctx = s.ctx;
  if (!ctx) return s;
  switch (e.type) {
    case "quoted":
      return s.stage === "quoting" ? { ...s, ctx: { ...ctx, quote: e.quote } } : s;
    case "waiting":
      return s.stage === "quoting" ? { ...s, ctx: { ...ctx, waitingFor: e.for } } : s;
    case "signing":
      return s.stage === "quoting" ? { ...s, stage: "signing", ctx: { ...ctx, waitingFor: null, t: { ...ctx.t, signing: e.at } } } : s;
    case "optimistic":
      if (s.stage !== "signing") return s;
      return { ...s, stage: "optimistic", ctx: { ...ctx, txHash: e.txHash, trade: e.trade, claimId: e.trade?.claim_id ?? ctx.claimId, t: { ...ctx.t, optimistic: e.at } } };
    case "final_late":
      return s.stage === "optimistic" ? { ...s, ctx: { ...ctx, finalNote: e.note } } : s;
    case "final": {
      if (s.stage !== "optimistic") return s;
      const next: DoubtCtx = { ...ctx, trade: e.trade ?? ctx.trade, finalNote: null, t: { ...ctx.t, final: e.at } };
      // whatever arrived early lands now, in order
      if (next.answer) return { ...s, stage: "answered", ctx: { ...next, t: { ...next.t, ...(next.rewrite ? { rewritten: e.at } : {}), answered: e.at } } };
      if (next.rewrite) return { ...s, stage: "rewritten", ctx: { ...next, t: { ...next.t, rewritten: e.at } } };
      return { ...s, stage: "final", ctx: next };
    }
    case "rewrite": {
      if (s.stage === "failed" || s.stage === "idle") return s;
      const rewrite = mergeRewrite(ctx.rewrite, e.rewrite);
      if (s.stage === "final") return { ...s, stage: "rewritten", ctx: { ...ctx, rewrite, t: { ...ctx.t, rewritten: e.at } } };
      return { ...s, ctx: { ...ctx, rewrite } }; // early (kept) or a newer status of the same rewrite
    }
    case "answer": {
      if (s.stage === "failed" || s.stage === "idle") return s;
      if (ctx.answer) return s; // the first answer is the answer
      const next = { ...ctx, answer: e.rationale };
      if (s.stage === "final" || s.stage === "rewritten") return { ...s, stage: "answered", ctx: { ...next, t: { ...next.t, answered: e.at } } };
      return { ...s, ctx: next };
    }
  }
  return s;
}

/** A newer version wins; the same version's later status (template, unsigned, signed) wins. */
function mergeRewrite(cur: Rewrite | null, next: Rewrite): Rewrite {
  if (!cur || cur.id !== next.id) return !cur || next.version >= cur.version ? next : cur;
  const rank = { template: 0, unsigned: 1, unverified: 2, signed: 3 } as Record<string, number>;
  return (rank[next.status] ?? 0) >= (rank[cur.status] ?? 0) ? next : cur;
}

// ---------- the app store ----------

export type PageKind = "home" | "page" | "post" | "claim" | "paste" | "agents" | "verify" | "audit" | "not_found";

export interface PageState {
  kind: PageKind;
  slug: string | null;
  loading: boolean;
  error: ApiFailure | null;
  sentences: Sentence[];
  notices: Notice[];
  message: string | null;
  planner: string | null;
  post: PostInfo | null;
  gone: { reason: string; message: string; link: string } | null;
  rationales: Rationale[];
  pages: { slug: string; claims: number; trades: number }[];
  aiStatus: any;
  audit: any;
  verify: { rewriteId: string | null; page: string | null; result: VerifyResult | null; running: boolean; error: string | null };
}

export interface AppState {
  route: Route;
  page: PageState;
  selected: string | null;
  doubt: DoubtState;
  lane: LaneState;
  live: LiveStatus;
  marketId: string | null;
  /** the latest trades anywhere, newest first */
  ticker: Mover[];
}

const emptyPage = (kind: PageKind, slug: string | null = null): PageState => ({
  kind, slug, loading: true, error: null, sentences: [], notices: [], message: null, planner: null, post: null, gone: null,
  rationales: [], pages: [], aiStatus: null, audit: null, verify: { rewriteId: null, page: null, result: null, running: false, error: null },
});

export interface StoreDeps {
  api: Api;
  lane: Lane;
  config: Config;
  now?: () => number;
  /** the measured corpus result, loaded on /audit */
  loadAudit?: () => Promise<any>;
  /** set false in tests that drive events by hand */
  stream?: boolean;
  /**
   * Where to listen for the first sign of a person (a touch, a click, a key, a scroll) before
   * asking for the free $1 key. Each key counts against the visitor address's daily allowance and
   * costs the lane gas, so page loads by previews, crawlers and screenshot runs must not spend one.
   * The browser passes window; tests leave it out and keep the old prefetch on open.
   */
  warmOn?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
}

export type Store = ReturnType<typeof createStore>;

export function createStore(deps: StoreDeps) {
  const now = deps.now ?? Date.now;
  const { api, lane, config } = deps;
  // the free key: on the first sign of a person when the browser gives us a place to listen,
  // otherwise (tests) on open as before. A bet always waits for the key either way.
  let warmed = !deps.warmOn;
  const WARM_EVENTS = ["pointerdown", "touchstart", "keydown", "wheel", "scroll"];
  const warm = () => {
    if (deps.warmOn) for (const ev of WARM_EVENTS) deps.warmOn.removeEventListener(ev, warm, true);
    warmed = true;
    void lane.prepare();
  };
  if (deps.warmOn) for (const ev of WARM_EVENTS) deps.warmOn.addEventListener(ev, warm, { capture: true, passive: true } as any);
  const prefetchLane = () => { if (warmed) void lane.prepare(); };
  let state: AppState = {
    route: { name: "home" }, page: emptyPage("home"), selected: null, doubt: IDLE, lane: lane.st, live: "connecting", marketId: null, ticker: [],
  };
  const listeners = new Set<(s: AppState) => void>();
  const recent: MarketEvent[] = []; // for late matching and anchor lookups
  let stream: EventStream | PollingEventStream | null = null;
  let loadSeq = 0;
  let refetchTimer: ReturnType<typeof setTimeout> | null = null;

  const set = (patch: Partial<AppState>) => {
    state = { ...state, ...patch };
    for (const fn of listeners) { try { fn(state); } catch { /* keep going */ } }
  };
  const setPage = (patch: Partial<PageState>) => set({ page: { ...state.page, ...patch } });
  const mapSentences = (fn: (s: Sentence) => Sentence) => setPage({ sentences: state.page.sentences.map(fn) });
  const dispatch = (e: DoubtEvent) => {
    const next = doubtReducer(state.doubt, e);
    if (next !== state.doubt) set({ doubt: next });
  };
  const find = (key: string) => state.page.sentences.find((s) => s.key === key) || null;
  const byClaim = (id: number) => state.page.sentences.find((s) => s.claimId === id) || null;

  lane.subscribe((l) => {
    set({ lane: l });
    if (l.state === "ready" && !state.marketId) set({ marketId: l.session.contractId });
  });

  // ---------- live events ----------

  function onEvent(e: MarketEvent) {
    recent.push(e);
    if (recent.length > 500) recent.shift();
    if (e.event === "trade" && e.source !== "ai") onTrade(e);
    else if (e.event === "rewrite" && e.source === "ai") onRewrite(e.data as Rewrite);
    else if (e.event === "agent_rationale") onRationale(e.data as Rationale);
    else if (e.event === "open" || e.event === "settle" || e.event === "challenge" || e.event === "provisional") scheduleRefetch();
  }

  function onTrade(e: MarketEvent) {
    const d = e.data || {};
    const id = Number(d.claim_id);
    const mine = d.trader === lane.trader;
    const mover: Mover = { trader: d.trader, side: d.side, amountUsd: Number(d.amount_micro || 0) / 1e6, priceAfter: Number(d.price_yes_ppm) / 1e6, at: e.blockTimestampMs ?? e.seenAtMs ?? now(), txHash: e.txHash, mine };
    set({ ticker: [mover, ...state.ticker].slice(0, 30) });
    const s = byClaim(id);
    if (!s) {
      // a sentence on this page opened by someone's first bet: pick up its claim
      if (state.page.kind === "post" || state.page.kind === "paste" || state.page.kind === "page") scheduleRefetch();
      return;
    }
    const inFlight = state.doubt.ctx?.claimId === id && doubtBusy(state.doubt) && !mine;
    mapSentences((x) => x.claimId === id ? {
      ...x, chainPpm: Number(d.price_yes_ppm), trades: x.trades + 1, movers: [mover, ...x.movers].slice(0, 20),
      // someone else's trade while ours is on its way: the quote no longer holds
      optimisticPpm: inFlight ? null : x.optimisticPpm,
    } : x);
  }

  function onRewrite(r: Rewrite) {
    if (!r || r.page !== state.page.slug) return;
    applyRewrite(r);
    const ctx = state.doubt.ctx;
    if (ctx && ctx.claimId !== null && r.sentences?.some((s) => s.claim_id === ctx.claimId) && (r.createdAt ?? now()) >= ctx.startedAt - 1000) {
      dispatch({ type: "rewrite", rewrite: r, at: now() });
    }
  }

  function applyRewrite(r: Rewrite) {
    const words = new Map(r.sentences.map((s) => [s.claim_id, s.text]));
    const info: SentenceRewrite = { id: r.id, version: r.version, status: r.status, signed: r.status === "signed", model: r.provenance?.model ?? null, diff: r.diff ?? null, paragraph: r.paragraph };
    mapSentences((x) => {
      if (x.claimId === null || !words.has(x.claimId)) return x;
      if (x.rewrite && (x.rewrite.version > r.version)) return x;
      return { ...x, text: words.get(x.claimId)!, paragraph: r.paragraph, rewrite: info };
    });
  }

  function onRationale(r: Rationale) {
    if (!r) return;
    const s = byClaim(r.claim_id);
    if (s) {
      mapSentences((x) => x.claimId === r.claim_id ? { ...x, source: r.source_url ? { url: r.source_url, title: r.source_title ?? null, agent: r.agent } : x.source } : x);
      setPage({ rationales: [r, ...state.page.rationales].slice(0, 50) });
    }
    const ctx = state.doubt.ctx;
    if (ctx && ctx.claimId === r.claim_id && r.account_id !== lane.trader && r.at >= ctx.startedAt - 1000) dispatch({ type: "answer", rationale: r, at: now() });
  }

  function scheduleRefetch() {
    if (refetchTimer) return;
    refetchTimer = setTimeout(() => { refetchTimer = null; void refetchClaims(); }, 400);
  }

  async function refetchClaims() {
    const p = state.page;
    if (!p.slug || !(p.kind === "page" || p.kind === "post" || p.kind === "paste")) return;
    const r = await api.claimsByPage(p.slug);
    if (!r.ok) return;
    const byText = new Map(r.value.map((c) => [c.text, c]));
    mapSentences((x) => {
      const c = (x.claimId !== null ? r.value.find((y) => y.id === x.claimId) : null) ?? (x.status === "unopened" ? byText.get(x.original) : undefined);
      if (!c) return x;
      const fresh = fromClaim(c, x.index);
      return { ...x, key: x.key, claimId: c.id, status: fresh.status, chainPpm: x.optimisticPpm !== null ? x.chainPpm : c.price_yes_ppm, bMicro: x.bMicro ?? fresh.bMicro, trades: c.trades, volumeUsd: fresh.volumeUsd, outcome: c.outcome, provisional: c.provisional, receipt: fresh.status === "open" ? null : x.receipt };
    });
  }

  function startStream() {
    if (stream || deps.stream === false) return;
    stream = api.events({ onEvent, onStatus: (s) => set({ live: s }) }).start();
  }

  // ---------- loading routes ----------

  async function open(route: Route) {
    const seq = ++loadSeq;
    const stale = () => seq !== loadSeq;
    const kind: PageKind = route.name === "not_found" ? "not_found" : route.name === "page" ? "page" : route.name;
    set({ route, selected: null, doubt: doubtBusy(state.doubt) ? state.doubt : IDLE, page: emptyPage(kind, route.name === "page" ? route.slug : null) });
    prefetchLane(); // after the first sign of a person, so the tap that follows is instant
    startStream();
    switch (route.name) {
      case "home": {
        const r = await api.allClaims();
        if (stale()) return;
        if (!r.ok) return setPage({ loading: false, error: r.error });
        const pages = new Map<string, { slug: string; claims: number; trades: number }>();
        for (const c of r.value) {
          const p = pages.get(c.page) || { slug: c.page, claims: 0, trades: 0 };
          p.claims++; p.trades += c.trades;
          pages.set(c.page, p);
        }
        const list = [...pages.values()].sort((a, b) => b.trades - a.trades);
        const live = list[0]?.slug ?? null;
        setPage({ loading: false, pages: list, slug: live, sentences: live ? r.value.filter((c) => c.page === live).sort((a, b) => a.id - b.id).map(fromClaim) : [] });
        if (live) void loadRewrites(live, seq);
        void backfillTicker();
        return;
      }
      case "page": {
        const [claims, rationales] = await Promise.all([api.claimsByPage(route.slug), api.rationales({ page: route.slug })]);
        if (stale()) return;
        if (!claims.ok) return setPage({ loading: false, error: claims.error });
        setPage({
          loading: false, sentences: claims.value.sort((a, b) => a.id - b.id).map(fromClaim), rationales: rationales.ok ? rationales.value : [],
          error: claims.value.length ? null : { state: "not_found", code: "empty_page", message: "Nothing is priced on this page yet.", status: 200, retryable: false },
        });
        for (const r of rationales.ok ? rationales.value : []) onRationale(r);
        return void loadRewrites(route.slug, seq);
      }
      case "post": {
        const r = await api.post(route.apiPath);
        if (stale()) return;
        if (!r.ok) return setPage({ loading: false, error: r.error });
        const v = r.value;
        if (v.gone) return setPage({ loading: false, kind: "post", slug: v.page, gone: { reason: v.reason, message: v.message, link: v.link } });
        setPage({
          loading: false, slug: v.page, post: v.post, notices: v.notices || [], message: v.message ?? null, planner: v.planner ?? null,
          sentences: (v.sentences || []).map(fromPlanned),
        });
        return void loadRewrites(v.page, seq);
      }
      case "claim": {
        const [c, rationales] = await Promise.all([api.claim(route.id), api.rationales({ claim: route.id })]);
        if (stale()) return;
        if (!c.ok) return setPage({ loading: false, error: c.error });
        setPage({ loading: false, slug: c.value.page, sentences: [fromClaim(c.value, 0)], rationales: rationales.ok ? rationales.value : [] });
        for (const r of rationales.ok ? rationales.value : []) onRationale(r);
        return void loadRewrites(c.value.page, seq);
      }
      case "agents": {
        const [st, rationales] = await Promise.all([api.aiStatus(), api.rationales()]);
        if (stale()) return;
        return setPage({ loading: false, aiStatus: st.ok ? st.value : null, rationales: rationales.ok ? rationales.value : [], error: st.ok ? null : st.error });
      }
      case "verify": {
        setPage({ loading: false, verify: { rewriteId: route.rewrite, page: route.page, result: null, running: false, error: null } });
        if (route.rewrite && route.page) await verify(route.page, route.rewrite);
        return;
      }
      case "audit": {
        try {
          const audit = await (deps.loadAudit ?? defaultLoadAudit)();
          if (!stale()) setPage({ loading: false, audit });
        } catch (e) {
          if (!stale()) setPage({ loading: false, error: { state: "error", code: "audit_unavailable", message: "The audit result couldn't be loaded.", status: 0, retryable: true } });
        }
        return;
      }
      case "not_found":
        return setPage({ loading: false, message: route.reason });
    }
  }

  async function loadRewrites(page: string, seq: number) {
    const r = await api.latestRewrites(page);
    if (seq !== loadSeq || !r.ok) return;
    for (const rw of r.value) applyRewrite(rw);
  }

  async function backfillTicker() {
    const r = await api.recentEvents(0);
    if (!r.ok) return;
    const movers = r.value.events.filter((e) => e.event === "trade" && e.source !== "ai").slice(-30).reverse().map((e) => ({
      trader: e.data.trader, side: e.data.side, amountUsd: Number(e.data.amount_micro || 0) / 1e6, priceAfter: Number(e.data.price_yes_ppm) / 1e6,
      at: e.blockTimestampMs ?? e.seenAtMs ?? now(), txHash: e.txHash, mine: e.data.trader === lane.trader,
    }));
    for (const e of r.value.events) { if (!recent.some((x) => x.uid === e.uid && e.uid)) recent.push(e); }
    set({ ticker: movers });
  }

  // ---------- the doubt ----------

  /** "Doubt it · $1": buy NO with the free credit (side "yes" backs it instead). */
  async function doubt(key: string, side: Side = "no", amountMicro: bigint = config.doubtMicro): Promise<DoubtState> {
    if (doubtBusy(state.doubt)) return state.doubt;
    const s = find(key);
    const at = now();
    dispatch({ type: "start", key, claimId: s?.claimId ?? null, side, amountMicro, priceBefore: s ? priceOf(s) : null, at });
    if (!s || !priceable(s)) {
      dispatch({ type: "fail", reason: "unpriced", message: s?.reason ?? undefined, at: now() });
      return state.doubt;
    }
    // 1. the ink moves at once, from the client-side quote
    const m = marketOf(s, config.defaultBMicro)!;
    const quote = quoteBuy(m, side, Number(amountMicro) / 1e6);
    if (quote.overflow) { dispatch({ type: "fail", reason: "overflow", at: now() }); return state.doubt; }
    dispatch({ type: "quoted", quote, at: now() });
    const afterPpm = Math.floor(quote.priceAfter * 1e6);
    mapSentences((x) => x.key === key ? { ...x, optimisticPpm: afterPpm } : x);
    const rollback = () => mapSentences((x) => x.key === key ? { ...x, optimisticPpm: null } : x);

    // 2. the key (prefetched at page load; "preparing your $1" if not yet)
    if (lane.st.state !== "ready") dispatch({ type: "waiting", for: "lane" });
    const ready = await lane.whenReady();
    if (!ready.ok) { rollback(); dispatch({ type: "fail", reason: ready.failure.reason, message: ready.failure.message, retryable: ready.failure.retryable, readOnly: ready.failure.readOnly, at: now() }); return state.doubt; }

    // 3. sign and send
    dispatch({ type: "signing", at: now() });
    const cur = find(key)!;
    const r = cur.status === "unopened" && cur.receipt && cur.claimId === null
      ? await lane.openAndBuy(cur.receipt.args, side, amountMicro)
      : await lane.buy(cur.claimId!, side, amountMicro);
    if (!r.ok) {
      rollback();
      dispatch({ type: "fail", reason: r.failure.reason, message: r.failure.message, retryable: r.failure.retryable, readOnly: r.failure.readOnly, at: now() });
      return state.doubt;
    }

    // 4. optimistic execution: the chain's price replaces the quote
    const trade = r.value;
    const ppm = trade?.price_yes_ppm_after ?? afterPpm;
    const claimId = trade?.claim_id ?? cur.claimId;
    const mover: Mover = { trader: lane.trader, side, amountUsd: Number(trade?.amount_micro ?? amountMicro) / 1e6, priceAfter: ppm / 1e6, at: now(), txHash: r.txHash, mine: true };
    mapSentences((x) => x.key === key ? { ...x, claimId, status: x.status === "unopened" ? "open" : x.status, receipt: x.status === "unopened" ? null : x.receipt, chainPpm: ppm, optimisticPpm: null, movers: [mover, ...x.movers.filter((m) => m.txHash !== r.txHash)].slice(0, 20) } : x);
    dispatch({ type: "optimistic", txHash: r.txHash, trade, at: now() });
    // events that arrived before we knew the claim (a market opened by this bet)
    for (const e of recent.slice(-50)) {
      if (e.event === "rewrite" && e.source === "ai") onRewrite(e.data);
      if (e.event === "agent_rationale") onRationale(e.data);
    }

    // 5. final
    let fin = await (r.final ?? lane.final(r.txHash));
    if (!fin.ok && fin.failure.reason === "rpc_stall") {
      dispatch({ type: "final_late", note: "Executed; waiting for NEAR to finalise it." });
      fin = await lane.final(r.txHash, { deadlineMs: 30000 });
    }
    if (fin.ok) {
      const ft = (fin.value as Trade | null) ?? trade;
      if (ft) mapSentences((x) => x.key === key && x.optimisticPpm === null ? { ...x, chainPpm: x.chainPpm ?? ft.price_yes_ppm_after } : x);
      dispatch({ type: "final", trade: ft, at: now() });
    } else {
      dispatch({ type: "final_late", note: `Executed, but final wasn't confirmed: ${fin.failure.message}` });
    }
    // a host with no scanner (the hosted site) hears of the trade from here; it checks it on-chain
    const done = (fin.ok ? (fin.value as Trade | null) : null) ?? trade;
    void api.afterTrade?.(r.txHash, ready.session.laneAccountId, claimId !== null && done ? { claim_id: claimId, price_yes_ppm: done.price_yes_ppm_after } : null);
    return state.doubt;
  }

  // ---------- verify ----------

  async function verify(page: string, rewriteId: string): Promise<VerifyResult | null> {
    setPage({ verify: { rewriteId, page, result: null, running: true, error: null } });
    const r = await api.rewriteById(page, rewriteId);
    if (!r.ok || !r.value) {
      setPage({ verify: { rewriteId, page, result: null, running: false, error: r.ok ? "No rewrite by that id." : r.error.message } });
      return null;
    }
    const marketId = state.marketId ?? (await marketIdFromHealth());
    const reader = () => lane.rpc ?? new NearRpc(config.rpcUrls);
    const result = await verifyRewrite(r.value, {
      modelKey: async (model) => {
        if (!marketId) throw new Error("the market id is unknown");
        const v = await reader().view<{ signing_address_hex: string } | null>(marketId, "get_model", { model });
        return v?.signing_address_hex ?? null;
      },
      findAnchor: anchorFromEvents(recent),
      anchorEvents: async (txHash, senderId) => {
        const o = await reader().txStatus(txHash, senderId);
        return eventsInOutcome(o, marketId || "").filter((e) => e.event === "rewrite").map((e) => e.data);
      },
    });
    setPage({ verify: { rewriteId, page, result, running: false, error: null } });
    return result;
  }

  async function marketIdFromHealth(): Promise<string | null> {
    const h = await api.health();
    const id = h.ok ? h.value.marketId : null;
    if (id) set({ marketId: id });
    return id;
  }

  // ---------- paste ----------

  async function paste(text: string) {
    const seq = ++loadSeq;
    set({ selected: null, page: { ...emptyPage("paste"), loading: true } });
    prefetchLane();
    startStream();
    const r = await api.paste(text);
    if (seq !== loadSeq) return;
    if (!r.ok) return setPage({ loading: false, error: r.error });
    setPage({ loading: false, slug: r.value.page, planner: r.value.planner, message: r.value.message ?? null, sentences: r.value.sentences.map(fromPlanned) });
  }

  return {
    get state() { return state; },
    subscribe(fn: (s: AppState) => void) { listeners.add(fn); return () => listeners.delete(fn); },
    open,
    paste,
    select(key: string | null) { set({ selected: key }); },
    doubt,
    resetDoubt() { dispatch({ type: "reset" }); },
    verify,
    /** for tests and the e2e: drive an event in by hand */
    ingest: onEvent,
    claimLane: (account: string) => lane.claimLane(account),
    derived: {
      price: priceOf,
      ink: inkOf,
      costToMove10: (s: Sentence) => costToMove10(s, config.defaultBMicro),
      quote: (s: Sentence, side: Side = "no", amountUsd = Number(config.doubtMicro) / 1e6) => { const m = marketOf(s, config.defaultBMicro); return m ? quoteBuy(m, side, amountUsd) : null; },
    },
    close() { stream?.close(); stream = null; if (refetchTimer) clearTimeout(refetchTimer); },
  };
}

// The site has no /audit route: a page that wants the corpus result passes deps.loadAudit.
async function defaultLoadAudit(): Promise<any> {
  throw new Error("no audit loader on this site");
}
