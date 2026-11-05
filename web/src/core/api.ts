// A typed client for services/api and the routes services/ai mounts on it. One base URL.
// Nothing here throws into a view: every call resolves to a Result, and every failure is
// mapped to a designed state with plain words (the server's own message when it has one).

export type ErrorState =
  | "offline" // the API could not be reached
  | "timeout" // it did not answer in time
  | "rate_limited" // this address used its share today
  | "daily_cap" // everyone's share for today is used
  | "used_up" // the judges' lane has no free credit left
  | "paused" // the market is paused
  | "unavailable" // a part is off or upstream is down (planner, lane, X, RPC)
  | "not_found"
  | "invalid" // the request was refused as malformed
  | "error"; // anything else

export interface ApiFailure {
  state: ErrorState;
  code: string;
  message: string;
  status: number;
  retryAfterS?: number;
  retryable: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiFailure };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(error: ApiFailure): Result<T> => ({ ok: false, error });

// ---------- shapes ----------

export type ClaimStatus = "Open" | "Challenged" | "Escalated" | "Settled";

export interface Claim {
  id: number;
  text: string;
  page: string;
  kind: "data" | "document" | "judgment" | string;
  price_yes_ppm: number;
  cost_up_10_micro: string;
  cost_down_10_micro: string;
  status: ClaimStatus;
  outcome: boolean | null;
  provisional: boolean | null;
  trades: number;
  volume_micro: string;
  open_interest_micro?: string;
  challenge_id?: number | null;
  prev?: number | null;
  next?: number | null;
  bounty_micro?: string;
  price_yes: number;
  cost_to_move: { up_10_points_usd: number; down_10_points_usd: number };
  volume_usd: number;
}

export interface MarketEvent<D = any> {
  seq: number;
  uid?: string;
  event: string;
  version?: string | null;
  data: D;
  /** "ai" for events services/ai publishes (rewrite, agent_rationale, jury_run); absent for chain events */
  source?: string;
  txHash?: string;
  receiptId?: string;
  signerId?: string;
  blockHeight?: number;
  blockTimestampMs?: number;
  seenAtMs?: number;
}

export interface TradeData {
  claim_id: number;
  trader: string;
  side: "yes" | "no" | "sell_yes" | "sell_no";
  shares_micro: string;
  amount_micro: string;
  price_yes_ppm: number;
  balance_micro: string;
}

export interface Health {
  ok: boolean;
  network: string;
  marketId: string | null;
  failures: string[];
  checks: Record<string, any>;
}

export interface Receipt {
  message: string;
  planner_sig_hex: string;
  args: { text: string; page: string; kind: string; p0_ppm: number; b_micro: string; planner_sig_hex: string };
}

export type SentenceStatus =
  | "priced" | "listed" | "pricing_soon" | "unfalsifiable" | "too_long" | "unlabelled"
  | "about_a_person" | "person" | string;

export interface PlannedSentence {
  index: number;
  text: string;
  status: SentenceStatus;
  label: string | null;
  kind?: string;
  p0_ppm?: number;
  receipt?: Receipt;
  claim?: Claim;
  reason?: string;
  greyed?: boolean;
  guard?: string;
}

export interface PasteResult {
  page: string;
  planner: "ok" | "unavailable";
  plannerReason?: string;
  model?: string;
  message?: string;
  truncated: boolean;
  totalSentences: number;
  bMicro: string;
  sentences: PlannedSentence[];
}

export interface PostInfo {
  id: string;
  url: string;
  authorName: string;
  handle: string;
  authorUrl?: string;
  date?: string;
  postedAt?: string;
  lang?: string;
  language?: string;
  text: string;
  mediaCount?: number;
  linkCount?: number;
  thread?: unknown;
  fetchedAt?: number;
  checkedAt?: number;
}

export interface Notice { code: string; message: string }

/** An open post, or a gone one (deleted or private: a designed result, not an error). */
export type PostResult =
  | (Partial<PasteResult> & { source: "x"; page: string; gone: false; post: PostInfo; notices: Notice[]; noText?: boolean; allOpinion?: boolean; voice?: string; message?: string; sentences: PlannedSentence[] })
  | { source: "x"; page: string; id: string; gone: true; reason: "deleted" | "private" | string; link: string; message: string };

export interface LaneKey {
  laneAccountId: string;
  contractId: string;
  publicKey: string;
  nonce: string;
  blockHash: string;
  rpc: string;
  rpcs: string[];
  methods: string[];
  allowanceYocto: string | null;
  maxGasTgas: number;
  reused: boolean;
}

export type ProvenanceStatus = "template" | "unsigned" | "signed" | "unverified";

export interface Provenance {
  kind: "template" | "model";
  status: ProvenanceStatus;
  verified: boolean;
  model: string | null;
  chat_id?: string | null;
  request_hash?: string;
  response_hash?: string;
  signed_text?: string | null;
  signature?: string | null;
  signing_address?: string | null;
  signing_algo?: string | null;
  signature_kind?: string | null;
  expected_signer?: string | null;
  reason?: string | null;
  attestation?: { ok: boolean; nonce: string; fetched_at: string; bundle: string | null } | null;
  /** the exact bytes: present in GET /rewrites, stripped from SSE events */
  request_b64?: string;
  response_b64?: string;
  /** an on-chain anchor_rewrite, when the writer has anchored this version */
  anchor?: { tx_hash: string; sender_id?: string } | null;
}

export interface DiffOp { op: "eq" | "ins" | "del"; text: string }

export interface Rewrite {
  id: string;
  page: string;
  paragraph: number;
  version: number;
  status: ProvenanceStatus;
  createdAt: number;
  updatedAt?: number;
  trigger?: { claim_id: number; txHash: string | null; trader: string | null; price_yes_ppm: number; seq: number | null };
  previous_text?: string;
  text: string;
  diff?: DiffOp[];
  sentences: { claim_id: number; claim: string; probability: number; band: string; text: string }[];
  provenance: Provenance;
  latency_ms?: Record<string, number>;
}

export interface Rationale {
  agent: string;
  label: string;
  house: boolean;
  account_id: string;
  model: string;
  claim_id: number;
  page: string;
  /** "yes" or "no" for a bet; "agree" when its credence sits at the price; "no_bet" when it disagrees but can't bet */
  side: "yes" | "no" | "agree" | "no_bet" | string;
  size_usd: number;
  text: string;
  price_before: number;
  price_after: number | null;
  credence: number;
  rationale: string;
  source_url: string | null;
  source_title?: string | null;
  tx_hash?: string | null;
  provenance?: Partial<Provenance>;
  at: number;
}

export interface AiStatus { writer: any; agents: any; jury: any; attestations: any }

// ---------- the client ----------

export interface ApiOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const PLAIN: Record<ErrorState, string> = {
  offline: "We can't reach Priced In right now. Check your connection; we'll keep trying.",
  timeout: "Priced In took too long to answer. Try again in a moment.",
  rate_limited: "This address has used its share for today.",
  daily_cap: "Today's share is used up. Come back tomorrow.",
  used_up: "The free $1 bets are used up for now. You can still read every price.",
  paused: "The market is paused: nothing can trade right now.",
  unavailable: "That part of Priced In is offline right now.",
  not_found: "Nothing here.",
  invalid: "That request didn't make sense to the server.",
  error: "Something went wrong on our side. Try again.",
};

/** The server's error codes, by the state the view designs for. */
const CODE_STATE: Record<string, ErrorState> = {
  rate_limited: "rate_limited",
  lane_daily_cap: "daily_cap",
  post_daily_cap: "daily_cap",
  lane_used_up: "used_up",
  market_paused: "paused",
  lane_unavailable: "unavailable",
  market_not_configured: "unavailable",
  lane_upstream_error: "unavailable",
  lane_tx_failed: "unavailable",
  lane_timeout: "timeout",
  upstream_error: "unavailable",
  x_rate_limited: "unavailable",
  x_unavailable: "unavailable",
  too_many_streams: "unavailable",
  no_such_claim: "not_found",
  not_found: "not_found",
  no_such_bundle: "not_found",
  post_deleted: "not_found",
  post_private: "not_found",
};

const RETRYABLE: Set<ErrorState> = new Set(["offline", "timeout", "unavailable"]);

/** Map an HTTP failure (status + the API's {error:{code,message}} body) to a designed state. */
export function mapFailure(status: number, body: any): ApiFailure {
  const e = body?.error;
  const code: string = typeof e?.code === "string" ? e.code : `http_${status}`;
  let state: ErrorState = CODE_STATE[code]
    ?? (status === 429 ? "rate_limited" : status === 404 ? "not_found" : status === 504 ? "timeout" : status >= 500 ? "unavailable" : status >= 400 ? "invalid" : "error");
  const message = typeof e?.message === "string" && e.message ? e.message : PLAIN[state];
  const retryAfterS = typeof e?.retryAfterS === "number" ? e.retryAfterS : undefined;
  return { state, code, message, status, retryAfterS, retryable: RETRYABLE.has(state) || code === "x_rate_limited" };
}

export function networkFailure(err: unknown): ApiFailure {
  const timeout = (err as any)?.name === "AbortError" || (err as any)?.name === "TimeoutError";
  const state: ErrorState = timeout ? "timeout" : "offline";
  return { state, code: timeout ? "timeout" : "offline", message: PLAIN[state], status: 0, retryable: true };
}

export class Api {
  readonly base: string;
  private f: typeof fetch;
  private timeoutMs: number;

  constructor(o: ApiOptions) {
    this.base = o.baseUrl.replace(/\/+$/, "");
    this.f = o.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
    this.timeoutMs = o.timeoutMs ?? 15000;
  }

  /** One request. `accept` lets a non-2xx status be a designed value (a gone post's 410). */
  async request<T>(method: "GET" | "POST", path: string, body?: unknown, { accept = [] as number[], timeoutMs = this.timeoutMs } = {}): Promise<Result<T>> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.f(this.base + path, {
        method,
        headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(t);
      return fail(networkFailure(e));
    }
    let json: any = null;
    try { json = await res.json(); } catch { json = null; } finally { clearTimeout(t); }
    if (res.ok || accept.includes(res.status)) {
      if (json === null) return fail({ state: "error", code: "bad_body", message: PLAIN.error, status: res.status, retryable: true });
      return ok(json as T);
    }
    return fail(mapFailure(res.status, json));
  }

  health() { return this.request<Health>("GET", "/health", undefined, { accept: [503] }); }

  async claimsByPage(page: string): Promise<Result<Claim[]>> {
    const r = await this.request<{ claims: Claim[] }>("GET", `/claims?page=${encodeURIComponent(page)}`);
    return r.ok ? ok(r.value.claims) : r;
  }

  async allClaims(): Promise<Result<Claim[]>> {
    const r = await this.request<{ claims: Claim[] }>("GET", "/claims");
    return r.ok ? ok(r.value.claims) : r;
  }

  async claim(id: number): Promise<Result<Claim>> {
    const r = await this.request<{ claim: Claim }>("GET", `/claims/${id}`);
    return r.ok ? ok(r.value.claim) : r;
  }

  recentEvents(since = 0) {
    return this.request<{ events: MarketEvent[]; lastBlockHeight: number | null; lastSeq: number }>("GET", `/events/recent?since=${since}`);
  }

  paste(text: string, page?: string) { return this.request<PasteResult>("POST", "/paste", page ? { text, page } : { text }, { timeoutMs: 30000 }); }

  /** A post by the site's own path (/jack/status/20, /x/20, /i/status/20) or any post link. */
  post(pathOrLink: string) {
    const p = pathOrLink.replace(/^\/+/, "");
    const path = /^https?:/i.test(p) || p.includes("?") ? `/post?url=${encodeURIComponent(p)}` : `/post/${p.split("/").map(encodeURIComponent).join("/")}`;
    return this.request<PostResult>("GET", path, undefined, { accept: [410], timeoutMs: 30000 });
  }

  laneKey(publicKey: string) { return this.request<LaneKey>("POST", "/lane/key", { publicKey }, { timeoutMs: 20000 }); }

  async rewrites(page: string, { history = false } = {}): Promise<Result<{ writer: any; rewrites: any[] }>> {
    return this.request("GET", `/rewrites?page=${encodeURIComponent(page)}${history ? "&history=1" : ""}`);
  }

  /** The latest version of each paragraph on a page. */
  async latestRewrites(page: string): Promise<Result<Rewrite[]>> {
    const r = await this.rewrites(page);
    return r.ok ? ok(r.value.rewrites as Rewrite[]) : r;
  }

  /** One rewrite version with its exact bytes (the SSE event carries only hashes). */
  async rewriteById(page: string, id: string): Promise<Result<Rewrite | null>> {
    const r = await this.rewrites(page, { history: true });
    if (!r.ok) return r;
    for (const p of r.value.rewrites as { versions?: Rewrite[]; latest?: Rewrite }[]) {
      const hit = (p.versions || []).find((v) => v.id === id) || (p.latest?.id === id ? p.latest : undefined);
      if (hit) return ok(hit);
    }
    return ok(null);
  }

  async rationales(q: { page?: string; claim?: number } = {}): Promise<Result<Rationale[]>> {
    const qs = new URLSearchParams();
    if (q.page) qs.set("page", q.page);
    if (q.claim !== undefined) qs.set("claim", String(q.claim));
    const r = await this.request<{ rationales: Rationale[]; agents: any }>("GET", `/rationales${qs.size ? `?${qs}` : ""}`);
    return r.ok ? ok(r.value.rationales) : r;
  }

  aiStatus() { return this.request<AiStatus>("GET", "/ai/status"); }
  attestations() { return this.request<{ attestations: any; files: string[] }>("GET", "/attestations"); }
  attestation(file: string) { return this.request<any>("GET", `/attestations/${encodeURIComponent(file)}`); }
  jury(challengeId: number) { return this.request<{ run: any; jury: any }>("GET", `/jury?challenge=${challengeId}`); }

  /** The live event stream, with reconnect and backfill. */
  events(o: Omit<EventStreamOptions, "api">) { return new EventStream({ ...o, api: this }); }

  /** For EventStream: a raw streaming GET. */
  stream(path: string, signal: AbortSignal) { return this.f(this.base + path, { headers: { accept: "text/event-stream" }, signal }); }
}

// ---------- the live stream ----------

export type LiveStatus = "connecting" | "live" | "polling" | "offline" | "closed";

export interface EventStreamOptions {
  api: Api;
  onEvent: (e: MarketEvent) => void;
  onStatus?: (s: LiveStatus, detail?: string) => void;
  since?: number;
  /** poll /events/recent this often while the stream is down */
  pollMs?: number;
  /** reconnect backoff bounds */
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

/** Parse SSE frames from a text buffer. Returns parsed frames and the unconsumed rest. */
export function parseSse(buf: string): { frames: { event: string; data: string; id: string | null; retry: number | null }[]; rest: string } {
  const frames: { event: string; data: string; id: string | null; retry: number | null }[] = [];
  const norm = buf.replace(/\r\n?/g, "\n");
  let i: number;
  let rest = norm;
  while ((i = rest.indexOf("\n\n")) >= 0) {
    const raw = rest.slice(0, i);
    rest = rest.slice(i + 2);
    let event = "message", id: string | null = null, retry: number | null = null;
    const data: string[] = [];
    for (const line of raw.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const c = line.indexOf(":");
      const field = c < 0 ? line : line.slice(0, c);
      const value = c < 0 ? "" : line.slice(c + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
      else if (field === "retry" && /^\d+$/.test(value)) retry = Number(value);
    }
    frames.push({ event, data: data.join("\n"), id, retry });
  }
  return { frames, rest };
}

/**
 * Follows GET /events. Each event reaches onEvent once (de-duplicated by uid, or seq).
 * When the stream drops it backfills from /events/recent, polls while it is down, and
 * reconnects with backoff from where it left off. A restarted server (its sequence numbers
 * behind ours) is noticed and followed from its start.
 */
export class EventStream {
  status: LiveStatus = "connecting";
  cursor: number;
  private o: Required<Omit<EventStreamOptions, "onStatus" | "since">> & Pick<EventStreamOptions, "onStatus">;
  private seen = new Set<string>();
  private order: string[] = [];
  private ac: AbortController | null = null;
  private closed = false;
  private backoff: number;
  private retryMs: number;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(o: EventStreamOptions) {
    this.o = { pollMs: 2000, minBackoffMs: 1000, maxBackoffMs: 15000, ...o } as any;
    this.cursor = o.since ?? 0;
    this.backoff = this.o.minBackoffMs;
    this.retryMs = this.o.minBackoffMs;
  }

  start() { void this.connect(); return this; }

  close() {
    this.closed = true;
    this.ac?.abort();
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.set("closed");
  }

  private set(s: LiveStatus, detail?: string) {
    if (this.status === s) return;
    this.status = s;
    this.o.onStatus?.(s, detail);
  }

  /** Deliver one event, once. */
  deliver(e: MarketEvent) {
    const key = e.uid ?? `seq:${e.seq}`;
    if (typeof e.seq === "number" && e.seq > this.cursor) this.cursor = e.seq;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.order.push(key);
    if (this.order.length > 5000) this.seen.delete(this.order.shift()!);
    try { this.o.onEvent(e); } catch { /* a view bug never stops the stream */ }
  }

  /** Read /events/recent after the cursor; follow a restarted server from its start. */
  async backfill(): Promise<boolean> {
    const r = await this.o.api.recentEvents(this.cursor);
    if (!r.ok) return false;
    if (r.value.lastSeq < this.cursor) {
      this.cursor = 0;
      const again = await this.o.api.recentEvents(0);
      if (!again.ok) return false;
      for (const e of again.value.events) this.deliver(e);
      return true;
    }
    for (const e of r.value.events) this.deliver(e);
    return true;
  }

  private async connect() {
    if (this.closed) return;
    this.set(this.status === "polling" || this.status === "offline" ? this.status : "connecting");
    this.ac = new AbortController();
    let res: Response;
    try {
      res = await this.o.api.stream(`/events?since=${this.cursor}`, this.ac.signal);
    } catch {
      return this.dropped("the live stream could not connect");
    }
    if (!res.ok || !res.body) return this.dropped(`the live stream answered ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { frames, rest } = parseSse(buf);
        buf = rest;
        for (const fr of frames) {
          if (fr.retry !== null) this.retryMs = fr.retry;
          if (fr.event === "hello") { this.stopPolling(); this.backoff = this.o.minBackoffMs; this.set("live"); continue; }
          if (!fr.data) continue;
          let e: MarketEvent;
          try { e = JSON.parse(fr.data); } catch { continue; }
          if (fr.id && typeof e.seq !== "number") e.seq = Number(fr.id);
          this.deliver(e);
        }
      }
    } catch { /* dropped */ }
    this.dropped("the live stream closed");
  }

  private dropped(detail: string) {
    if (this.closed) return;
    this.set(this.status === "live" || this.status === "connecting" ? "polling" : this.status, detail);
    this.startPolling();
    const wait = Math.max(this.retryMs, this.backoff);
    this.backoff = Math.min(this.o.maxBackoffMs, this.backoff * 2);
    this.reconnectTimer = setTimeout(() => void this.connect(), wait);
  }

  private startPolling() {
    if (this.pollTimer || this.closed) return;
    const tick = async () => {
      this.pollTimer = null;
      if (this.closed || this.status === "live") return;
      const okay = await this.backfill();
      const now = this.status as LiveStatus; // the stream may have come back while we polled
      if (now !== "live") this.set(okay ? "polling" : "offline");
      if (!this.closed && (this.status as LiveStatus) !== "live") this.pollTimer = setTimeout(tick, this.o.pollMs);
    };
    this.pollTimer = setTimeout(tick, 0);
  }

  private stopPolling() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
