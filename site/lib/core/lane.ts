// Copied unchanged from web/src/core/lane.ts (the proven engine). Fix bugs there first, then copy.
// The no-wallet bet. The browser makes its own ed25519 key, keeps it (localStorage, or memory
// when storage is blocked), and asks services/api to add it to the pooled lane account as a
// function-call key on the market (POST /lane/key). That happens at page load, so by the
// time a visitor taps "Doubt it · $1" the key is ready and the bet is signed here, with no
// approval. The contract tells lane visitors apart by this key: trader "lane:<public key>".
//
// Sending follows services/api: one transaction at a time per key (nonces never race), a
// synchronous send raced with an async broadcast to a second RPC, then a wait for final.

import { KeyPair, KeyPairSigner, actions, createTransaction, baseDecode, baseEncode } from "near-api-js";
import type { Api, ApiFailure, LaneKey } from "./api";
import { assertNetwork, ConfigError, type Config } from "./config";
import { NearRpc, RpcError, b64, unb64, type TxOutcome } from "./rpc";

// ---------- key storage ----------

export interface KeyStore {
  get(): string | null;
  set(secret: string): void;
  readonly persistent: boolean;
}

export class MemoryKeyStore implements KeyStore {
  private v: string | null = null;
  readonly persistent = false;
  get() { return this.v; }
  set(s: string) { this.v = s; }
}

/** localStorage when it works; memory when the browser blocks storage. */
export function browserKeyStore(network: string, storage: Storage | undefined = globalThis.localStorage): KeyStore {
  const name = `pricedin.lane.${network}.v1`;
  try {
    if (!storage) throw new Error("no storage");
    const probe = `${name}.probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return {
      persistent: true,
      get: () => { try { return storage.getItem(name); } catch { return null; } },
      set: (s: string) => { try { storage.setItem(name, s); } catch { /* full or blocked: this visit still works */ } },
    };
  } catch {
    return new MemoryKeyStore();
  }
}

// ---------- failures, in plain words ----------

export type LaneFailureReason =
  | "preparing" // the key is not ready yet ("preparing your $1")
  | "used_up" // no free credit left on the market today
  | "rate_limited" // this address used its free bets today
  | "daily_cap" // everyone's free bets are used today
  | "paused"
  | "unavailable" // the lane is off or upstream failed
  | "offline"
  | "network_mismatch" // the server handed back an account or RPC from the other network
  | "rpc_stall" // no RPC executed the transaction in time
  | "nonce_clash" // another transaction from this key took the nonce, twice
  | "allowance_spent" // the key's gas allowance is used up
  | "credit_spent" // the $1 credit is already bet
  | "settled" // the claim is settled: no more trading
  | "slippage"
  | "no_such_claim"
  | "bad_receipt" // the planner's receipt did not verify on-chain
  | "not_allowed" // the key may not call this method
  | "rejected"; // any other contract refusal

export interface LaneFailure {
  reason: LaneFailureReason;
  message: string;
  retryable: boolean;
  /** the read-only path is the way on: prices still load, nothing can be bet */
  readOnly: boolean;
  retryAfterS?: number;
  detail?: string;
}

const WORDS: Record<LaneFailureReason, string> = {
  preparing: "Preparing your $1…",
  used_up: "The free $1 bets are used up for today. Every price still updates live, and you can fund your own account from any chain.",
  rate_limited: "This address has used its free bets for today. Every price still updates live.",
  daily_cap: "Today's free bets are all taken. Every price still updates live; come back tomorrow.",
  paused: "The market is paused, so nothing can be bet right now.",
  unavailable: "The free $1 isn't available right now. Every price still updates live.",
  offline: "You're offline, so the bet wasn't sent.",
  network_mismatch: "This page is pointed at the wrong NEAR network, so it refuses to sign anything.",
  rpc_stall: "NEAR didn't confirm the bet in time. It may still land; we'll show it if it does.",
  nonce_clash: "Two bets from this browser crossed. Try once more.",
  allowance_spent: "This browser's free key has used its gas allowance. Every price still updates live.",
  credit_spent: "You've already placed your free $1.",
  settled: "This sentence is settled: it can't be bet on any more.",
  slippage: "The price moved before your bet landed. Try again at the new price.",
  no_such_claim: "That sentence has no market yet.",
  bad_receipt: "The sentence's opening price didn't verify, so its market wasn't opened.",
  not_allowed: "The free key can't do that.",
  rejected: "The market refused the bet.",
};

const READ_ONLY: Set<LaneFailureReason> = new Set(["used_up", "rate_limited", "daily_cap", "allowance_spent", "credit_spent", "paused", "unavailable", "network_mismatch"]);
const RETRYABLE: Set<LaneFailureReason> = new Set(["preparing", "offline", "rpc_stall", "nonce_clash", "slippage", "unavailable"]);

export function laneFailure(reason: LaneFailureReason, o: { message?: string; detail?: string; retryAfterS?: number } = {}): LaneFailure {
  return { reason, message: o.message || WORDS[reason], retryable: RETRYABLE.has(reason), readOnly: READ_ONLY.has(reason), retryAfterS: o.retryAfterS, detail: o.detail };
}

/** /lane/key failures to lane reasons. */
export function fromApiFailure(e: ApiFailure): LaneFailure {
  const reason: LaneFailureReason =
    e.state === "used_up" ? "used_up"
      : e.state === "rate_limited" ? "rate_limited"
        : e.state === "daily_cap" ? "daily_cap"
          : e.state === "paused" ? "paused"
            : e.state === "offline" ? "offline"
              : "unavailable";
  // the server's own sentence is already plain; keep ours for states it words for engineers
  const message = reason === "rate_limited" || reason === "daily_cap" || reason === "used_up" ? e.message : undefined;
  return laneFailure(reason, { message, detail: `${e.code}: ${e.message}`, retryAfterS: e.retryAfterS });
}

/** A contract panic or RPC error to a lane reason. */
export function classifyTxError(err: unknown): LaneFailure {
  const text = err instanceof RpcError ? `${err.message} ${JSON.stringify(err.info.data ?? "")}` : typeof err === "string" ? err : JSON.stringify(err ?? "");
  const detail = text.slice(0, 400);
  if (err instanceof RpcError && (err.info.name === "STALL" || err.info.transport)) return laneFailure(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "rpc_stall", { detail });
  if (/InvalidNonce/i.test(text)) return laneFailure("nonce_clash", { detail });
  if (/NotEnoughAllowance/i.test(text)) return laneFailure("allowance_spent", { detail });
  if (/AccessKeyNotFound|UNKNOWN_ACCESS_KEY/i.test(text)) return laneFailure("preparing", { detail, message: "Your free key isn't on the lane any more. Preparing a new $1…" });
  if (/MethodNameMismatch|ReceiverMismatch|does not allow/i.test(text)) return laneFailure("not_allowed", { detail });
  if (/lane is used up/i.test(text)) return laneFailure("used_up", { detail });
  if (/not enough balance/i.test(text)) return laneFailure("credit_spent", { detail });
  if (/claim is settled|not settled/i.test(text)) return laneFailure("settled", { detail });
  if (/slippage/i.test(text)) return laneFailure("slippage", { detail });
  if (/no such claim/i.test(text)) return laneFailure("no_such_claim", { detail });
  if (/planner signature|no planner key/i.test(text)) return laneFailure("bad_receipt", { detail });
  if (/\bpaused\b/i.test(text)) return laneFailure("paused", { detail });
  if (/Expired|InvalidChain/i.test(text)) return laneFailure("rpc_stall", { detail });
  return laneFailure("rejected", { detail });
}

/** The panic text of a failed outcome, or null when it succeeded. */
export function outcomeFailure(o: TxOutcome): string | null {
  const st = o.status as any;
  if (!st || typeof st !== "object" || !("Failure" in st)) return null;
  const ex = st.Failure?.ActionError?.kind?.FunctionCallError?.ExecutionError;
  return ex || JSON.stringify(st.Failure).slice(0, 400);
}

/** The function's JSON return value. */
export function outcomeValue<T = any>(o: TxOutcome): T | null {
  const v = (o.status as any)?.SuccessValue;
  if (!v) return null;
  try { return JSON.parse(new TextDecoder().decode(unb64(v))); } catch { return null; }
}

// ---------- the lane ----------

/** What the contract returns from buy, sell and open_and_buy. */
export interface Trade {
  claim_id: number;
  trader: string;
  side: string;
  shares_micro: string;
  amount_micro: string;
  price_yes_ppm_before: number;
  price_yes_ppm_after: number;
  balance_micro: string;
}

export type LaneState =
  | { state: "idle" }
  | { state: "preparing"; since: number; attempt: number }
  | { state: "ready"; session: LaneSession }
  | { state: "failed"; failure: LaneFailure };

export interface LaneSession extends LaneKey {
  /** "lane:<public key>": how the contract names this visitor */
  trader: string;
  rpcUrls: string[];
}

export interface Sent<T = any> {
  ok: true;
  txHash: string;
  outcome: TxOutcome;
  value: T | null;
  ms: number;
}
export type LaneResult<T = any> = Sent<T> | { ok: false; failure: LaneFailure; txHash?: string };

export interface Signed {
  method: string;
  args: object;
  txHash: string;
  signedB64: string;
  nonce: bigint;
}

export interface LaneOptions {
  api: Api;
  config: Config;
  keys?: KeyStore;
  rpc?: (urls: string[]) => NearRpc;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const TGAS = 10n ** 12n;

export class Lane {
  st: LaneState = { state: "idle" };
  private o: Required<Omit<LaneOptions, "keys">> & { keys: KeyStore };
  private kp: KeyPair | null = null;
  private signer: KeyPairSigner | null = null;
  private inflight: Promise<LaneState> | null = null;
  private listeners = new Set<(s: LaneState) => void>();
  private nonce: bigint | null = null;
  private blockHash: string | null = null;
  private blockHashAt = 0;
  private chain: Promise<unknown> = Promise.resolve();
  rpc: NearRpc | null = null;

  constructor(o: LaneOptions) {
    this.o = {
      keys: o.keys ?? browserKeyStore(o.config.network),
      rpc: o.rpc ?? ((urls) => new NearRpc(urls)),
      now: o.now ?? Date.now,
      sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      api: o.api,
      config: o.config,
    };
  }

  subscribe(fn: (s: LaneState) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private set(s: LaneState) { this.st = s; for (const fn of this.listeners) { try { fn(s); } catch { /* keep going */ } } }

  /** This browser's key, made once and kept. */
  publicKey(): string {
    if (!this.kp) {
      const saved = this.o.keys.get();
      let kp: KeyPair | null = null;
      if (saved) { try { kp = KeyPair.fromString(saved as any); } catch { kp = null; } }
      if (!kp) { kp = KeyPair.fromRandom("ed25519"); this.o.keys.set(kp.toString()); }
      this.kp = kp;
      this.signer = new KeyPairSigner(kp);
    }
    return this.kp.getPublicKey().toString();
  }

  get trader() { return `lane:${this.publicKey()}`; }

  /**
   * Ask for the function-call key (prefetched at page load). Retries a retryable failure once.
   * Concurrent callers share one request.
   */
  prepare(): Promise<LaneState> {
    if (this.st.state === "ready") return Promise.resolve(this.st);
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const pk = this.publicKey();
      let failure: LaneFailure | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        this.set({ state: "preparing", since: this.o.now(), attempt });
        const r = await this.o.api.laneKey(pk);
        if (r.ok) {
          try {
            const session = this.accept(r.value);
            this.set({ state: "ready", session });
            return this.st;
          } catch (e) {
            failure = e instanceof ConfigError ? laneFailure("network_mismatch", { detail: e.message }) : laneFailure("unavailable", { detail: String((e as Error).message) });
            break;
          }
        }
        failure = fromApiFailure(r.error);
        if (!r.error.retryable || attempt === 2) break;
        await this.o.sleep(600);
      }
      this.set({ state: "failed", failure: failure! });
      return this.st;
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** Check the key answer belongs to this network and this key, and start a session. */
  private accept(k: LaneKey): LaneSession {
    const cfg = this.o.config;
    assertNetwork(cfg.network, k.laneAccountId, k.contractId, k.rpc, ...(k.rpcs || []));
    if (k.publicKey !== this.publicKey()) throw new Error("the lane answered for a different key");
    if (!k.methods?.includes("buy")) throw new Error("the lane key cannot buy");
    const rpcUrls = (k.rpcs?.length ? k.rpcs : k.rpc ? [k.rpc] : cfg.rpcUrls).slice(0, 4);
    this.rpc = this.o.rpc(rpcUrls.length ? rpcUrls : cfg.rpcUrls);
    this.nonce = BigInt(k.nonce);
    this.blockHash = k.blockHash;
    this.blockHashAt = this.o.now();
    return { ...k, trader: `lane:${k.publicKey}`, rpcUrls: this.rpc.urls };
  }

  /** Resolve when ready, or with the failure; "preparing" after timeoutMs. */
  async whenReady(timeoutMs = this.o.config.laneReadyTimeoutMs): Promise<{ ok: true; session: LaneSession } | { ok: false; failure: LaneFailure }> {
    if (this.st.state === "ready") return { ok: true, session: this.st.session };
    let timer: any;
    const timeout = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), timeoutMs); });
    const s = await Promise.race([this.prepare(), timeout]);
    clearTimeout(timer);
    if (s === "timeout") return { ok: false, failure: laneFailure("preparing", { message: "Preparing your $1 is taking longer than it should. Try again in a moment." }) };
    return s.state === "ready" ? { ok: true, session: s.session } : { ok: false, failure: s.state === "failed" ? s.failure : laneFailure("unavailable") };
  }

  private session(): LaneSession {
    if (this.st.state !== "ready") throw new Error("lane not ready");
    return this.st.session;
  }

  private async freshBlockHash(force = false): Promise<string> {
    if (!force && this.blockHash && this.o.now() - this.blockHashAt < 60_000) return this.blockHash;
    this.blockHash = await this.rpc!.finalBlockHash();
    this.blockHashAt = this.o.now();
    return this.blockHash;
  }

  /** Sign one function call with the next nonce. */
  async sign(method: string, args: object, gasTgas?: number): Promise<Signed> {
    const s = this.session();
    this.publicKey();
    const nonce = (this.nonce ?? BigInt(s.nonce)) + 1n;
    this.nonce = nonce;
    const gas = BigInt(Math.min(gasTgas ?? s.maxGasTgas ?? this.o.config.gasTgas, s.maxGasTgas || 300)) * TGAS;
    const tx = createTransaction(s.laneAccountId, this.kp!.getPublicKey(), s.contractId, nonce, [actions.functionCall(method, args, gas, 0n)], baseDecode(await this.freshBlockHash()));
    const { txHash, signedTransaction } = await this.signer!.signTransaction(tx);
    return { method, args, txHash: baseEncode(txHash), signedB64: b64(signedTransaction.encode()), nonce };
  }

  /**
   * Send a signed call until it executes (optimistic). A nonce clash re-reads the nonce and
   * re-signs once; an expired block hash is refreshed once. Returns the final tx hash used.
   */
  async submit<T = any>(signed: Signed, { deadlineMs = this.o.config.stallMs } = {}): Promise<LaneResult<T>> {
    const s = this.session();
    let cur = signed;
    const t0 = this.o.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      let outcome: TxOutcome;
      try {
        outcome = await this.rpc!.sendRace(cur.signedB64, cur.txHash, s.laneAccountId, { deadlineMs });
      } catch (e) {
        const f = classifyTxError(e);
        if (attempt === 0 && f.reason === "nonce_clash") {
          await this.resyncNonce(e);
          cur = await this.sign(cur.method, cur.args);
          continue;
        }
        if (attempt === 0 && /Expired|InvalidChain/i.test(f.detail || "")) {
          await this.freshBlockHash(true).catch(() => {});
          this.nonce = cur.nonce - 1n;
          cur = await this.sign(cur.method, cur.args);
          continue;
        }
        if (f.reason === "preparing") { this.set({ state: "idle" }); void this.prepare(); }
        return { ok: false, failure: f, txHash: cur.txHash };
      }
      const panic = outcomeFailure(outcome);
      if (panic) return { ok: false, failure: classifyTxError(panic), txHash: cur.txHash };
      return { ok: true, txHash: cur.txHash, outcome, value: outcomeValue<T>(outcome), ms: this.o.now() - t0 };
    }
    return { ok: false, failure: laneFailure("nonce_clash"), txHash: cur.txHash };
  }

  /** Take the access key's nonce from the error, or read it. */
  private async resyncNonce(err: unknown) {
    const m = /"?ak_nonce"?\s*:\s*"?(\d+)/.exec(err instanceof RpcError ? `${err.message} ${JSON.stringify(err.info.data ?? "")}` : String(err));
    if (m) { this.nonce = BigInt(m[1]); return; }
    try { this.nonce = BigInt((await this.rpc!.viewAccessKey(this.session().laneAccountId, this.publicKey())).nonce); } catch { /* keep ours */ }
  }

  /** Wait for final. */
  async final<T = any>(txHash: string, { deadlineMs = 20000 } = {}): Promise<LaneResult<T>> {
    const s = this.session();
    const t0 = this.o.now();
    try {
      const outcome = await this.rpc!.waitFinal(txHash, s.laneAccountId, { deadlineMs });
      const panic = outcomeFailure(outcome);
      if (panic) return { ok: false, failure: classifyTxError(panic), txHash };
      return { ok: true, txHash, outcome, value: outcomeValue<T>(outcome), ms: this.o.now() - t0 };
    } catch (e) {
      return { ok: false, failure: classifyTxError(e), txHash };
    }
  }

  /** One call end to end, serialized per key so nonces never race. */
  call<T = any>(method: string, args: object): Promise<LaneResult<T> & { final?: Promise<LaneResult<T>> }> {
    const run = this.chain.then(async () => {
      const ready = await this.whenReady();
      if (!ready.ok) return { ok: false as const, failure: ready.failure };
      let signed: Signed;
      try { signed = await this.sign(method, args); } catch (e) { return { ok: false as const, failure: classifyTxError(e) }; }
      const r = await this.submit<T>(signed);
      return r.ok ? { ...r, final: this.final<T>(r.txHash) } : r;
    });
    this.chain = run.catch(() => {});
    return run;
  }

  // ---------- the calls ----------

  buy(claimId: number, side: "yes" | "no", amountMicro: bigint, minSharesMicro = 0n) {
    return this.call<Trade>("buy", { claim_id: claimId, side, amount_micro: amountMicro.toString(), min_shares_micro: minSharesMicro.toString() });
  }

  sell(claimId: number, side: "yes" | "no", sharesMicro: bigint, minProceedsMicro = 0n) {
    return this.call<Trade>("sell", { claim_id: claimId, side, shares_micro: sharesMicro.toString(), min_proceeds_micro: minProceedsMicro.toString() });
  }

  /** Open a pasted sentence's market with its first bet, from the planner's receipt args. */
  openAndBuy(receiptArgs: { text: string; page: string; kind: string; p0_ppm: number; b_micro: string; planner_sig_hex: string }, side: "yes" | "no", amountMicro: bigint) {
    return this.call<Trade>("open_and_buy", { ...receiptArgs, side, amount_micro: amountMicro.toString() });
  }

  redeem(claimId: number) { return this.call<string>("redeem", { claim_id: claimId }); }

  /** Move winnings above the $1 credit to a real NEAR account. The credit itself stays. */
  claimLane(account: string) {
    try { assertNetwork(this.o.config.network, account); } catch (e) {
      return Promise.resolve({ ok: false as const, failure: laneFailure("network_mismatch", { detail: (e as Error).message, message: `${account} is not a ${this.o.config.network} account.` }) });
    }
    return this.call<string>("claim_lane", { account });
  }

  // ---------- reads ----------

  private reader(): NearRpc { return this.rpc ?? (this.rpc = this.o.rpc(this.o.config.rpcUrls)); }

  /** micro-USDC this visitor holds on the market (0 before the first bet credits the $1). */
  async balanceMicro(contractId: string): Promise<bigint> {
    return BigInt(await this.reader().view<string>(contractId, "get_balance", { trader: this.trader }));
  }

  async position(contractId: string, claimId: number): Promise<{ yes_micro: string; no_micro: string }> {
    return this.reader().view(contractId, "get_position", { claim_id: claimId, trader: this.trader });
  }

  /** What claim_lane could move out now. */
  async claimableMicro(contractId: string): Promise<bigint> {
    return BigInt(await this.reader().view<string>(contractId, "lane_claimable", { trader: this.trader }));
  }
}
