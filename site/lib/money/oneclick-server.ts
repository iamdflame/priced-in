// The server half of 1Click: every request to 1Click is built here from a few checked fields, so the
// /bridge routes can't be used as an open proxy, and a partner JWT (ONECLICK_JWT, optional) never
// reaches the browser.
import "server-only";
import { ONECLICK, routesFrom, validAddress, validNearAccount, type BridgeQuote, type BridgeRoute, type BridgeStatusView, type TokenRow } from "./oneclick";
import { moneyConfig } from "./config";

const JWT = process.env.ONECLICK_JWT || "";

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (JWT) h["x-api-key"] = JWT;
  return h;
}

export class BridgeError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

let cache: { at: number; routes: BridgeRoute[] } | null = null;

export async function routes(): Promise<BridgeRoute[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.routes;
  const r = await fetch(`${ONECLICK}/tokens`, { headers: headers(), signal: AbortSignal.timeout(10_000), cache: "no-store" }).catch(() => null);
  if (!r || !r.ok) throw new BridgeError(502, "oneclick_unreachable", "NEAR Intents didn’t answer. Try again in a moment.");
  const list = (await r.json()) as TokenRow[];
  cache = { at: Date.now(), routes: routesFrom(list) };
  return cache.routes;
}

export interface InParams { route: string; amount: string; recipient: string; refundTo?: string | null; dry: boolean }
export interface OutParams { route: string; amountMicro: string; recipient: string; refundTo: string; dry: boolean }

const isUnits = (s: unknown): s is string => typeof s === "string" && /^[1-9]\d{0,30}$/.test(s);

/** Money in: any listed asset on its own chain, delivered as USDC to the person's NEAR account. */
export async function quoteIn(p: InParams): Promise<BridgeQuote> {
  const c = moneyConfig();
  if (!c.usdcAsset) throw new BridgeError(400, "unsupported_network", "Cross-chain deposits run on mainnet only.");
  const r = (await routes()).find((x) => x.key === p.route && x.in);
  if (!r) throw new BridgeError(400, "unknown_route", "Pick a chain and asset from the list.");
  if (!isUnits(p.amount)) throw new BridgeError(400, "bad_amount", "Enter an amount above zero.");
  if (!validNearAccount(p.recipient)) throw new BridgeError(400, "bad_recipient", "Connect a NEAR wallet first: the USDC is delivered to it.");
  const refund = p.refundTo?.trim() || "";
  if (refund && !validAddress(r.addr, refund)) throw new BridgeError(400, "bad_refund", `That isn’t a ${r.chainName} address.`);
  const minutes = Math.max(60, r.slowMin * 3);
  return quote("in", r.key, {
    dry: p.dry, swapType: "EXACT_INPUT", slippageTolerance: 100,
    originAsset: r.assetId, depositType: "ORIGIN_CHAIN", destinationAsset: c.usdcAsset, amount: p.amount,
    refundTo: refund || p.recipient, refundType: refund ? "ORIGIN_CHAIN" : "INTENTS",
    recipient: p.recipient, recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + minutes * 60_000).toISOString(),
  });
}

/** Money out: USDC on NEAR, sent from the person's wallet, delivered as a stablecoin on another chain. */
export async function quoteOut(p: OutParams): Promise<BridgeQuote> {
  const c = moneyConfig();
  if (!c.usdcAsset) throw new BridgeError(400, "unsupported_network", "Cross-chain withdrawals run on mainnet only.");
  const r = (await routes()).find((x) => x.key === p.route && x.out);
  if (!r) throw new BridgeError(400, "unknown_route", "Pick a chain and asset from the list.");
  if (!isUnits(p.amountMicro)) throw new BridgeError(400, "bad_amount", "Enter an amount above zero.");
  if (!validAddress(r.addr, p.recipient)) throw new BridgeError(400, "bad_recipient", `That isn’t a ${r.chainName} address.`);
  if (!validNearAccount(p.refundTo)) throw new BridgeError(400, "bad_refund", "Connect a NEAR wallet first: a refund goes back to it.");
  return quote("out", r.key, {
    dry: p.dry, swapType: "EXACT_INPUT", slippageTolerance: 100,
    originAsset: c.usdcAsset, depositType: "ORIGIN_CHAIN", destinationAsset: r.assetId, amount: p.amountMicro,
    refundTo: p.refundTo, refundType: "ORIGIN_CHAIN",
    recipient: p.recipient.trim(), recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
}

async function quote(dir: "in" | "out", route: string, body: Record<string, unknown>): Promise<BridgeQuote> {
  const r = await fetch(`${ONECLICK}/quote`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), cache: "no-store" }).catch(() => null);
  if (!r) throw new BridgeError(502, "oneclick_unreachable", "NEAR Intents didn’t answer. Try again in a moment.");
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.quote) {
    const msg = String(j?.message || j?.error || `NEAR Intents answered ${r.status}.`);
    throw new BridgeError(r.status === 401 ? 502 : 400, "no_quote", /amount is too low|too small|min/i.test(msg) ? "That amount is too small to route. Try more." : msg);
  }
  const q = j.quote;
  return {
    dir, route,
    depositAddress: q.depositAddress ?? null, depositMemo: q.depositMemo ?? null,
    amountIn: String(q.amountIn), amountInFormatted: String(q.amountInFormatted),
    amountOut: String(q.amountOut), amountOutFormatted: String(q.amountOutFormatted), minAmountOut: String(q.minAmountOut),
    timeEstimate: Number(q.timeEstimate) || 0, sendBy: String(body.deadline),
    recipient: String(body.recipient), refundTo: String(body.refundTo), refundsInIntents: body.refundType === "INTENTS",
  };
}

export async function status(depositAddress: string, depositMemo?: string | null): Promise<BridgeStatusView> {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(depositAddress)) throw new BridgeError(400, "bad_address", "Unknown deposit address.");
  const u = new URL(`${ONECLICK}/status`);
  u.searchParams.set("depositAddress", depositAddress);
  if (depositMemo) u.searchParams.set("depositMemo", depositMemo);
  const r = await fetch(u, { headers: headers(), signal: AbortSignal.timeout(10_000), cache: "no-store" }).catch(() => null);
  if (!r) throw new BridgeError(502, "oneclick_unreachable", "NEAR Intents didn’t answer.");
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 404) throw new BridgeError(404, "unknown_deposit", "NEAR Intents doesn’t know this deposit address.");
  if (!r.ok || !j?.status) throw new BridgeError(502, "bad_status", "NEAR Intents sent a status we couldn’t read.");
  const d = j.swapDetails || {};
  const first = (a: any) => (Array.isArray(a) && a.length ? String(a[0]?.hash ?? a[0]) : null);
  return {
    status: j.status,
    amountOut: d.amountOut ?? null,
    refundedFormatted: d.refundedAmountFormatted && d.refundedAmountFormatted !== "0" ? d.refundedAmountFormatted : null,
    refundReason: d.refundReason ?? null,
    destinationTx: first(d.destinationChainTxHashes),
    nearTxs: Array.isArray(d.nearTxHashes) ? d.nearTxHashes.map(String) : [],
  };
}

export async function submit(depositAddress: string, txHash: string): Promise<void> {
  if (!/^[A-Za-z0-9]{8,128}$/.test(depositAddress) || !/^[A-Za-z0-9]{20,100}$/.test(txHash)) throw new BridgeError(400, "bad_input", "Bad deposit address or transaction hash.");
  await fetch(`${ONECLICK}/deposit/submit`, { method: "POST", headers: headers(), body: JSON.stringify({ depositAddress, txHash }), signal: AbortSignal.timeout(10_000), cache: "no-store" }).catch(() => null);
}

export function errorJson(e: unknown) {
  const b = e instanceof BridgeError ? e : new BridgeError(500, "internal", "Something went wrong on our side.");
  return Response.json({ error: { code: b.code, message: b.message } }, { status: b.status, headers: { "cache-control": "no-store" } });
}
