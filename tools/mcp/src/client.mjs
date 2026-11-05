// The Priced In API, as the MCP tools see it: settings from the caller's environment, plain
// reads, and x402 payment beyond the free tier with the caller's own NEAR key.

export const DEFAULT_RPC = { testnet: "https://test.rpc.fastnear.com", mainnet: "https://free.rpc.fastnear.com" };

/** Settings from the environment of whoever runs the server: their API, their key, their caps. */
export function settings(env = process.env) {
  const errors = [];
  const network = (env.NEAR_NETWORK || "testnet").trim();
  if (network !== "testnet" && network !== "mainnet") errors.push(`NEAR_NETWORK must be testnet or mainnet, got "${network}"`);
  const net = network === "mainnet" ? "mainnet" : "testnet";
  const accountId = (env.PRICEDIN_NEAR_ACCOUNT_ID || env.NEAR_ACCOUNT_ID || "").trim() || null;
  const privateKey = (env.PRICEDIN_NEAR_PRIVATE_KEY || env.NEAR_PRIVATE_KEY || "").trim() || null;
  const wrong = net === "testnet" ? ".near" : ".testnet";
  if (accountId && accountId.endsWith(wrong)) errors.push(`NEAR_ACCOUNT_ID=${accountId} is a ${net === "testnet" ? "mainnet" : "testnet"} account but NEAR_NETWORK=${net}`);
  const s = {
    network: net,
    caip2: `near:${net}`,
    apiUrl: (env.PRICEDIN_API_URL || "http://127.0.0.1:8787").trim().replace(/\/+$/, ""),
    rpcUrl: (env.NEAR_RPC_URL || DEFAULT_RPC[net]).trim(),
    accountId,
    privateKey,
    maxBetUsd: Number(env.PRICEDIN_MAX_BET_USD || 5),
    maxPayUsd: Number(env.PRICEDIN_MAX_PAY_USD || 0.05),
    autoPay: env.PRICEDIN_PAY !== "0",
    errors,
  };
  if (net === "testnet" && /mainnet|free\.rpc\.fastnear/.test(s.rpcUrl)) errors.push(`NEAR_RPC_URL ${s.rpcUrl} looks like mainnet but NEAR_NETWORK=testnet`);
  if (net === "mainnet" && /testnet|test\.rpc/.test(s.rpcUrl)) errors.push(`NEAR_RPC_URL ${s.rpcUrl} looks like testnet but NEAR_NETWORK=mainnet`);
  return s;
}

export const hasKey = (s) => !!(s.accountId && s.privateKey);

export class PricedIn {
  /** @param {ReturnType<typeof settings>} s */
  constructor(s, { fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
    this.s = s;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this._info = null;
  }

  async get(path, fetchImpl = this.fetch) {
    let r;
    try { r = await fetchImpl(this.s.apiUrl + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) }); }
    catch (e) { throw new Error(`the Priced In API at ${this.s.apiUrl} did not answer (${e.cause?.code || e.message}). Set PRICEDIN_API_URL to a running API.`); }
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json, headers: r.headers };
  }

  /** GET /v1, cached: the API's network, contract, USDC and price. */
  async info() {
    if (!this._info) {
      const r = await this.get("/v1");
      if (r.status !== 200 || !r.json) throw new Error(`GET /v1 answered ${r.status}`);
      if (r.json.network !== this.s.network) throw new Error(`the API at ${this.s.apiUrl} runs on ${r.json.network}, but NEAR_NETWORK=${this.s.network} here; refusing to mix networks`);
      this._info = r.json;
    }
    return this._info;
  }

  /**
   * A metered call: free while the free tier lasts, then paid by x402 with the caller's key
   * (only within PRICEDIN_MAX_PAY_USD and on our network). Returns { status, json, paid }.
   */
  async metered(path) {
    const first = await this.get(path);
    if (first.status !== 402) return { ...first, paid: null };
    const challenge = first.json || {};
    const req = (challenge.accepts || []).find((a) => a.network === this.s.caip2);
    const price = req ? Number(req.amount) / 1e6 : null;
    const why = (m) => ({ status: 402, json: challenge, paid: null, unpaid: m });
    if (!req) return why(`the API asks for payment on ${(challenge.accepts || []).map((a) => a.network).join(", ")}, not ${this.s.caip2}`);
    if (!hasKey(this.s)) return why(`the free tier is used up; each call costs $${price.toFixed(2)} in USDC by x402. Set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (your own full-access ${this.s.network} key holding USDC${this.s.network === "testnet" ? `: call faucet() on ${req.asset} for 10 test USDC` : ""}) to pay.`);
    if (!this.s.autoPay) return why("the free tier is used up and PRICEDIN_PAY=0 forbids paying");
    if (!(price <= this.s.maxPayUsd)) return why(`the API asks $${price} a call, above PRICEDIN_MAX_PAY_USD=${this.s.maxPayUsd}`);
    const { createNearPaymentFetch } = await import("@fastnear/x402");
    const { createLocalNearSigner } = await import("@fastnear/x402/node");
    const signer = createLocalNearSigner({ accountId: this.s.accountId, secretKey: this.s.privateKey, rpcUrls: { [this.s.caip2]: this.s.rpcUrl } });
    const paidFetch = createNearPaymentFetch({ signer, network: this.s.caip2, fetch: this.fetch });
    const r = await this.get(path, paidFetch);
    return { ...r, paid: r.json?.payment ?? null };
  }

  credence({ question, claimId, page, limit, open }) {
    const p = new URLSearchParams();
    if (claimId !== undefined && claimId !== null) p.set("claim", String(claimId));
    else p.set("q", question);
    if (page) p.set("page", page);
    if (limit) p.set("limit", String(limit));
    if (open === false) p.set("open", "0");
    return this.metered(`/v1/credence?${p}`);
  }

  quote({ claimId, side, amountUsd }) {
    return this.get(`/v1/quote?claim=${claimId}&side=${side}&amount_usd=${amountUsd}`);
  }

  claim(id) { return this.get(`/claims/${id}`); }
}
