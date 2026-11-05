// x402 v2 payments on NEAR (the "exact" scheme of @x402/near): the resource-server side, and
// our own facilitator. The wire format is the protocol's, so any x402 client pays us as is,
// for example @fastnear/x402's createNearPaymentFetch with the caller's own NEAR key.
//
//   1. A request beyond the free tier gets 402 with a PAYMENT-REQUIRED header: base64 JSON
//      { x402Version: 2, error, resource, accepts: [requirements] }, and the same JSON as body.
//   2. The client signs a NEP-366 delegate action of exactly one ft_transfer of `amount` of
//      `asset` to `payTo`, and retries with PAYMENT-SIGNATURE: base64 JSON of the payload.
//   3. We verify it with the facilitator, compute the answer, then settle: the facilitator's
//      relayer submits the delegate action and reports success only once the inner
//      ft_transfer receipt succeeded on chain. The answer goes out with PAYMENT-RESPONSE:
//      base64 JSON { success, transaction, network, payer }: the settled receipt.
//
// Nothing is settled for an answer that failed, and nothing is answered for a payment that
// did not settle. The facilitator is in-process when this API holds a relayer key
// (X402_RELAYER_ACCOUNT_ID / X402_RELAYER_PRIVATE_KEY), or remote (X402_FACILITATOR_URL).

export const X402_VERSION = 2;
export const HEADERS = { required: "PAYMENT-REQUIRED", signature: "payment-signature", legacy: "x-payment", response: "PAYMENT-RESPONSE" };

export const b64json = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
export function unb64json(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/=_-]+$/.test(s.trim())) throw new Error("not base64");
  return JSON.parse(Buffer.from(s.trim(), "base64").toString("utf8"));
}

export const caip2 = (network) => `near:${network}`;
export const explorerTx = (network, tx) => `https://${network === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${tx}`;

/** The one way we accept to be paid, as x402 PaymentRequirements. */
export function requirements(x) {
  return { scheme: "exact", network: caip2(x.network), asset: x.asset, amount: String(x.priceMicro), payTo: x.payTo, maxTimeoutSeconds: x.maxTimeoutS, extra: {} };
}

const SAME = ["scheme", "network", "asset", "amount", "payTo"];
export const sameRequirements = (a, b) => !!a && !!b && SAME.every((k) => String(a[k]) === String(b[k]));

/** The 402 body (and, base64, the PAYMENT-REQUIRED header). */
export function paymentRequired(x, { url, error, description }) {
  return { x402Version: X402_VERSION, error, resource: { url, description, mimeType: "application/json" }, accepts: [requirements(x)] };
}

/** A remote facilitator over the protocol's HTTP interface. */
export class HttpFacilitator {
  constructor(url, { fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
    this.url = url.replace(/\/+$/, "");
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.kind = "http";
  }
  async post(path, paymentPayload, paymentRequirements) {
    const r = await this.fetch(`${this.url}/${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload, paymentRequirements }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const j = await r.json().catch(() => null);
    if (!j || typeof j !== "object") throw new Error(`facilitator ${path}: HTTP ${r.status}, no JSON`);
    return j;
  }
  verify(p, req) { return this.post("verify", p, req); }
  settle(p, req) { return this.post("settle", p, req); }
  async getSupported() { const r = await this.fetch(`${this.url}/supported`, { signal: AbortSignal.timeout(this.timeoutMs) }); return r.json(); }
}

/** Our own facilitator, in-process: @fastnear/x402's NEAR facilitator with our relayer key. */
export async function nearFacilitator(x, rpcUrl) {
  const { createNearFacilitator } = await import("@fastnear/x402/facilitator");
  const network = caip2(x.network);
  const f = createNearFacilitator({ registrations: [{ network, signer: { relayers: [{ accountId: x.relayerId, secretKey: x.relayerKey }], rpcUrls: { [network]: rpcUrl } } }] });
  return { kind: "in-process", relayer: x.relayerId, verify: (p, r) => f.verify(p, r), settle: (p, r) => f.settle(p, r), getSupported: () => f.getSupported() };
}

/** Read the client's payment header, if any: v2 PAYMENT-SIGNATURE, or v1's X-PAYMENT name. */
export function paymentHeader(req) {
  return req.headers[HEADERS.signature] || req.headers[HEADERS.legacy] || null;
}

/**
 * The paywall for one route.
 * @param {object} x config.x402
 * @param {{ verify: Function, settle: Function }|null} facilitator
 */
export class Paywall {
  constructor(x, facilitator, { log = () => {} } = {}) {
    this.x = x;
    this.f = facilitator;
    this.log = log;
    this.stats = { challenges: 0, verified: 0, settled: 0, refused: 0, settleFailures: 0, lastTx: null };
  }

  get enabled() { return !!(this.f && this.x.payTo && this.x.asset); }

  challenge(url, error, description) {
    this.stats.challenges++;
    const body = paymentRequired(this.x, { url, error, description });
    return { status: 402, body: { ...body, message: error }, headers: { [HEADERS.required]: b64json(body) } };
  }

  /**
   * Run `work` behind a payment.
   * @param {string} header the PAYMENT-SIGNATURE value
   * @param {string} url the resource URL (for the challenge)
   * @param {() => Promise<{status: number, body: object, headers?: object}>} work
   */
  async charge(header, url, description, work) {
    let payload;
    try { payload = unb64json(header); } catch { this.stats.refused++; return this.challenge(url, "The PAYMENT-SIGNATURE header is not base64 JSON.", description); }
    const req = requirements(this.x);
    if (payload?.x402Version !== X402_VERSION) { this.stats.refused++; return this.challenge(url, `Only x402 version ${X402_VERSION} is accepted.`, description); }
    if (!sameRequirements(payload.accepted, req)) { this.stats.refused++; return this.challenge(url, "The payment does not accept these requirements (scheme, network, asset, amount or payTo differ).", description); }
    let v;
    try { v = await this.f.verify(payload, req); } catch (e) { this.log(`x402 verify failed: ${e.message}`); return { status: 502, body: { error: { code: "facilitator_unavailable", message: "The payment facilitator did not answer. Nothing was charged; try again." } } }; }
    if (!v?.isValid) { this.stats.refused++; return this.challenge(url, `Payment refused: ${v?.invalidReason || "invalid"}${v?.invalidMessage ? ` (${v.invalidMessage})` : ""}.`, description); }
    this.stats.verified++;
    const out = await work();
    if (out.status >= 400) return { ...out, body: { ...out.body, payment: { settled: false, note: "The request failed, so the payment was not settled. Nothing was charged." } } };
    let s;
    try { s = await this.f.settle(payload, req); } catch (e) { s = { success: false, errorReason: "settlement_failed", errorMessage: e.message }; }
    if (!s?.success) {
      this.stats.settleFailures++;
      this.log(`x402 settle failed: ${s?.errorReason} ${s?.errorMessage || ""}`);
      return this.challenge(url, `Payment did not settle: ${s?.errorReason || "unknown"}${s?.errorMessage ? ` (${s.errorMessage})` : ""}.`, description);
    }
    this.stats.settled++;
    this.stats.lastTx = s.transaction;
    const receipt = {
      settled: true, transaction: s.transaction, network: s.network || req.network, payer: s.payer ?? v.payer ?? null,
      amount: req.amount, asset: req.asset, payTo: req.payTo, usd: Number(req.amount) / 1e6,
      explorer: s.transaction ? explorerTx(this.x.network, s.transaction) : null,
    };
    return { status: out.status, body: { ...out.body, payment: receipt }, headers: { ...(out.headers || {}), [HEADERS.response]: b64json(s) } };
  }
}
