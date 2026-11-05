// The four tools: ask (the credence call), get_claim, quote (the LMSR cost of a bet), and bet
// (signed with the caller's own NEAR key from their environment; refused without one).

import { PricedIn, settings as loadSettings, hasKey } from "./client.mjs";
import { placeBet } from "./near.mjs";

const pct = (p) => `${(Math.round(p * 1000) / 10).toFixed(1).replace(/\.0$/, "")}%`;
const usd = (x) => `$${Number(x).toFixed(2)}`;
const short = (s, n = 16) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

/** One claim of a credence answer as a few readable lines. */
export function claimLines(c) {
  const L = [];
  L.push(`Claim ${c.claim_id} (page ${c.page}): "${c.text}"`);
  if (c.match) L.push(`Match: ${c.match.kind}${c.match.kind === "close" ? `, score ${c.match.score}` : ""}`);
  L.push(`Credence: ${pct(c.credence)} true · ${usd(c.open_interest_usd)} open interest · +10 pts costs ${usd(c.cost_to_move_10_points.up_usd)}, -10 pts ${usd(c.cost_to_move_10_points.down_usd)}`);
  L.push(`Resolution: ${c.resolution.state}. ${c.resolution.note}`);
  if (c.rationales?.length) {
    L.push("Rationales:");
    for (const r of c.rationales) L.push(`  - ${r.agent || r.account_id || "agent"}${r.model ? ` (${r.model})` : ""}${r.side ? `, ${r.side.toUpperCase()}` : ""}${r.credence !== null && r.credence !== undefined ? ` at ${pct(r.credence)}` : ""}: ${r.rationale}${r.source_url ? ` Source: ${r.source_url}` : ""}`);
  } else L.push("Rationales: none posted yet.");
  if (c.recent_trades?.length) L.push(`Recent trades: ${c.recent_trades.map((t) => `${t.side.toUpperCase()} ${usd(t.amount_usd)} -> ${pct(t.price_yes_after)} (${t.tx_explorer})`).join("; ")}`);
  const p = c.provenance;
  let prov = `Provenance: ${p.contract} on ${p.network}, claim ${p.claim_id} (view ${p.view.method} ${JSON.stringify(p.view.args)})`;
  const w = p.last_rewrite;
  if (w) prov += `; last rewrite ${w.id || `v${w.version}`} signed by ${w.model}${w.signature ? ` (ed25519 ${short(w.signature)})` : ""}${w.anchor_tx ? `, anchored in ${w.anchor_explorer}` : ""}${w.key_note ? `. ${w.key_note}` : ""}`;
  L.push(prov);
  return L;
}

function paidLine(paid, free) {
  if (paid?.settled) return `Paid ${usd(paid.usd)} by x402 on ${paid.network}: ${paid.explorer}`;
  if (free) return `Free calls left today from this address: ${free.remaining} of ${free.limit}.`;
  return null;
}

/**
 * @param {{ env?: object, fetchImpl?: typeof fetch, allowBet?: boolean, betImpl?: typeof placeBet }} [o]
 */
export function makeTools(o = {}) {
  const s = loadSettings(o.env || process.env);
  const api = new PricedIn(s, { fetchImpl: o.fetchImpl });
  const bet = o.betImpl || placeBet;
  const configError = s.errors.length ? `Configuration refused: ${s.errors.join("; ")}` : null;
  const guard = () => (configError ? { text: configError, isError: true } : null);

  const ask = {
    name: "ask",
    title: "How sure should I be?",
    description: "Ask Priced In how sure to be about a factual claim, with money behind the answer. Pass the claim or a question. Returns the matching claims (an exact page sentence, else the closest by text) with the market's price as a credence, the open interest, the cost to move it 10 points, the latest agents' rationales with source URLs, the resolution state and on-chain provenance. Says plainly when nothing matches, and offers to open the claim. Free for a few calls a day; then $0.01 in USDC by x402, paid with your own NEAR key if you set one.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", minLength: 2, maxLength: 600, description: "A claim or a question, e.g. \"Does Tether issue USDT on NEAR?\"" },
        page: { type: "string", description: "Only claims on this page slug, e.g. tether" },
        limit: { type: "integer", minimum: 1, maximum: 10, description: "At most this many claims (default 3)" },
      },
      required: ["question"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(a) {
      const g = guard(); if (g) return g;
      const r = await api.credence({ question: a.question, page: a.page, limit: a.limit });
      if (r.status === 402) return { text: `Not answered: ${r.unpaid}`, data: { status: 402, challenge: r.json }, isError: true };
      if (r.status !== 200) return { text: `Priced In answered ${r.status}: ${r.json?.error?.message || "error"}`, data: r.json ?? undefined, isError: true };
      const j = r.json;
      const L = [];
      if (!j.matched) {
        L.push(j.answer);
        const sents = j.open?.result?.sentences || [];
        if (sents.length) {
          L.push(`To open it: ${j.open.how}`);
          for (const x of sents) L.push(`  - "${x.text}": ${x.status}${x.receipt ? " (signed receipt ready for open_and_buy)" : ""}${x.reason ? `. ${x.reason}` : ""}`);
          if (j.open.result.planner === "unavailable") L.push("  The planner is offline on this API, so nothing is priced yet: \"pricing soon\".");
        }
      } else {
        L.push(j.answer, "");
        for (const c of j.claims) L.push(...claimLines(c), "");
      }
      const pl = paidLine(r.paid, j.free);
      if (pl) L.push(pl);
      return { text: L.join("\n").trim(), data: j };
    },
  };

  const getClaim = {
    name: "get_claim",
    title: "Read one claim",
    description: "Read one Priced In claim by id: its price, open interest, cost to move, rationales, resolution and provenance. Counts as a credence call; when the free tier is used up and no key is set, falls back to the claim's bare on-chain view.",
    inputSchema: { type: "object", properties: { claim_id: { type: "integer", minimum: 0 } }, required: ["claim_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(a) {
      const g = guard(); if (g) return g;
      const r = await api.credence({ claimId: a.claim_id });
      if (r.status === 200) {
        const c = r.json.claims[0];
        return { text: [...claimLines(c), paidLine(r.paid, r.json.free)].filter(Boolean).join("\n"), data: r.json };
      }
      if (r.status === 404) return { text: `No claim ${a.claim_id}.`, isError: true };
      if (r.status === 402) {
        const raw = await api.claim(a.claim_id);
        if (raw.status === 200) {
          const c = raw.json.claim;
          return { text: `Claim ${c.id}: "${c.text}" is at ${pct(c.price_yes)} true (${c.status}). The full answer with rationales and provenance needs a credence call: ${r.unpaid}`, data: raw.json };
        }
      }
      return { text: `Priced In answered ${r.status}: ${r.json?.error?.message || r.unpaid || "error"}`, isError: true };
    },
  };

  const quote = {
    name: "quote",
    title: "Cost of a bet",
    description: "Quote a bet on a Priced In claim from its LMSR: the shares you get for a dollar amount on YES or NO, the payout if right, and where the price ends up. Free; places nothing.",
    inputSchema: {
      type: "object",
      properties: { claim_id: { type: "integer", minimum: 0 }, side: { type: "string", enum: ["yes", "no"] }, amount_usd: { type: "number", exclusiveMinimum: 0, maximum: 1000 } },
      required: ["claim_id", "side", "amount_usd"], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(a) {
      const g = guard(); if (g) return g;
      const r = await api.quote({ claimId: a.claim_id, side: a.side, amountUsd: a.amount_usd });
      if (r.status !== 200) return { text: `No quote: ${r.json?.error?.message || r.status}`, isError: true };
      const q = r.json.quote;
      return {
        text: `${usd(q.amount_usd)} on ${q.side.toUpperCase()} of claim ${q.claim_id} ("${r.json.text}") buys ${q.shares.toFixed(4)} shares at ${q.avg_price.toFixed(4)} each: pays ${usd(q.payout_if_right_usd)} if ${q.side.toUpperCase()} is right (profit ${usd(q.profit_if_right_usd)}). The price moves from ${pct(q.price_yes_before)} to ${pct(q.price_yes_after)} YES.`,
        data: r.json,
      };
    },
  };

  const betTool = {
    name: "bet",
    title: "Place a bet",
    description: "Bet on a Priced In claim with your own NEAR key (NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY in this server's environment; refused without them, and Priced In never lends a key). Deposits the test USDC the market balance lacks (on testnet, from the token's faucet if needed), then calls buy with a slippage guard. Capped by PRICEDIN_MAX_BET_USD (default $5).",
    inputSchema: {
      type: "object",
      properties: {
        claim_id: { type: "integer", minimum: 0 }, side: { type: "string", enum: ["yes", "no"] },
        amount_usd: { type: "number", exclusiveMinimum: 0, maximum: 1000 },
        faucet: { type: "boolean", description: "testnet only: take 10 test USDC from the token's faucet if the account holds too little (default true)" },
      },
      required: ["claim_id", "side", "amount_usd"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async handler(a) {
      const g = guard(); if (g) return g;
      if (o.allowBet === false) return { text: "This MCP server is shared, so it places no bets: run pricedin-mcp yourself with your own NEAR key to bet.", isError: true };
      if (!hasKey(s)) return { text: "Refused: bet signs with your own NEAR key, and none is set. Put NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (a full-access key of your own account) in this MCP server's environment. Priced In never signs for you.", isError: true };
      if (a.amount_usd > s.maxBetUsd) return { text: `Refused: $${a.amount_usd} is above PRICEDIN_MAX_BET_USD=${s.maxBetUsd}.`, isError: true };
      const info = await api.info();
      if (!info.contract || !info.usdc) return { text: "The API names no market contract or USDC token; nothing to bet on.", isError: true };
      const qr = await api.quote({ claimId: a.claim_id, side: a.side, amountUsd: a.amount_usd });
      if (qr.status !== 200) return { text: `No bet: ${qr.json?.error?.message || qr.status}`, isError: true };
      const q = qr.json.quote;
      const r = await bet(s, { market: info.contract, usdc: info.usdc, claimId: a.claim_id, side: a.side, amountMicro: BigInt(q.amount_micro), minSharesMicro: BigInt(q.min_shares_micro), faucet: a.faucet !== false });
      const t = r.trade || {};
      return {
        text: `Bet placed by ${s.accountId}: ${usd(Number(t.amount_micro ?? q.amount_micro) / 1e6)} on ${a.side.toUpperCase()} of claim ${a.claim_id}, ${(Number(t.shares_micro ?? 0) / 1e6).toFixed(4)} shares; YES ${pct((t.price_yes_ppm_before ?? q.price_yes_before * 1e6) / 1e6)} -> ${pct((t.price_yes_ppm_after ?? q.price_yes_after * 1e6) / 1e6)}. ${r.explorer}`,
        data: { ...r, quote: q, network: s.network, account: s.accountId },
      };
    },
  };

  return { tools: [ask, getClaim, quote, betTool], settings: s, api };
}
