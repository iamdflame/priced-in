// The truth API: "how sure should I be about this claim?", answered with money behind it.
// GET /v1/credence?q=<question or claim> finds the market's matching claims (an exact page
// sentence first, then the closest by text, see match.mjs) and returns for each: the price,
// open interest, the cost to move it 10 points, the latest agents' rationales with their
// source URLs, the resolution state, and provenance (contract, claim id, the last rewrite's
// signature). With no match it says so plainly and offers to open the claim: the paste
// flow's result, whose signed receipts open_and_buy accepts.

import fs from "node:fs";
import { ClaimIndex } from "./match.mjs";
import { explorerTx } from "./x402.mjs";

const usd = (micro) => Math.round(Number(micro || 0)) / 1e6;
const pct = (p) => `${(Math.round(p * 1000) / 10).toFixed(1).replace(/\.0$/, "")}%`;
const money = (x) => (x >= 100 ? `$${Math.round(x)}` : `$${x.toFixed(2)}`);

/** Liquidity b implied by the contract's cost-to-move figures (LMSR: cost = b ln((1-p)/(1-t))). */
export function impliedB(p, upUsd, downUsd) {
  if (upUsd > 0 && p + 0.1 < 0.999) return upUsd / Math.log((1 - p) / (1 - p - 0.1));
  if (downUsd > 0 && p - 0.1 > 0.001) return downUsd / Math.log(p / (p - 0.1));
  return null;
}

/**
 * An LMSR quote for spending `amountUsd` on `side`, from the claim's public view. The contract
 * charges whole micro-USDC and floors shares to micro, so the real fill can differ from this
 * by a micro or two; min_shares_micro (1% under the estimate by default) guards the rest.
 */
export function quoteBuy(claim, side, amountUsd, { slippage = 0.01 } = {}) {
  if (side !== "yes" && side !== "no") throw new Error('side must be "yes" or "no"');
  if (!(amountUsd > 0) || amountUsd > 1e6) throw new Error("amount_usd must be a positive number of dollars");
  const pYes = claim.price_yes_ppm / 1e6;
  const b = impliedB(pYes, usd(claim.cost_up_10_micro), usd(claim.cost_down_10_micro));
  if (!b) throw new Error("this market is at the edge of its range; no quote");
  const q = side === "yes" ? pYes : 1 - pYes;
  const shares = b * Math.log((Math.exp(amountUsd / b) - (1 - q)) / q);
  const e = Math.exp(shares / b);
  const sideAfter = (q * e) / (1 - q + q * e);
  const yesAfter = side === "yes" ? sideAfter : 1 - sideAfter;
  const sharesMicro = Math.floor(shares * 1e6);
  return {
    claim_id: claim.id, side, amount_usd: amountUsd, amount_micro: String(Math.round(amountUsd * 1e6)),
    shares: sharesMicro / 1e6, avg_price: amountUsd / shares,
    payout_if_right_usd: sharesMicro / 1e6, profit_if_right_usd: sharesMicro / 1e6 - amountUsd,
    price_yes_before: pYes, price_yes_after: Math.round(yesAfter * 1e6) / 1e6,
    liquidity_b_usd: Math.round(b * 1e4) / 1e4,
    min_shares_micro: String(Math.floor(sharesMicro * (1 - slippage))),
    method: "LMSR closed form on the contract's public view (b implied by its cost-to-move figures)",
  };
}

function resolutionOf(c, challenge) {
  const settled = c.status === "Settled" || (c.outcome !== null && c.outcome !== undefined);
  const out = c.outcome === true ? "true" : c.outcome === false ? "false" : null;
  let state = "open", note = "Open: nobody has challenged it. The price is the market's credence.";
  if (settled) { state = "settled"; note = `Settled ${out}: the market paid out on it.`; }
  else if (c.provisional !== null && c.provisional !== undefined) { state = "provisional"; note = `The jury's provisional ruling is ${c.provisional ? "true" : "false"}; the bonded dispute window is open.`; }
  else if (c.challenge_id !== null && c.challenge_id !== undefined) { state = "challenged"; note = "Challenged: the jury is ruling."; }
  return { state, status: c.status, outcome: out, provisional: c.provisional ?? null, challenge_id: c.challenge_id ?? null, ...(challenge ? { challenge } : {}), note };
}

/**
 * @param {{ config: object, claims: import('./claims.mjs').Claims|null, hub: object, rewrites: object,
 *   rpc: object, rationales?: (claimId: number) => Promise<object[]>, paste?: Function, now?: () => number, log?: Function }} o
 */
export function createCredence(o) {
  const { config, claims, hub, rewrites, rpc } = o;
  const now = o.now || Date.now;
  const cc = config.credence;
  const indexes = new WeakMap();
  const indexOf = (list) => {
    let ix = indexes.get(list);
    if (!ix) { ix = new ClaimIndex(list); indexes.set(list, ix); }
    return ix;
  };

  // signed rewrites recorded elsewhere (for example the judge deployment's evidence file)
  for (const f of cc.rewriteEvidence) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      const rec = j.record || j;
      if (j.market && config.marketId && j.market !== config.marketId) { o.log?.(`credence: ${f} is for ${j.market}, not this market; skipped`); continue; }
      if (rec?.id && rec.page) rewrites.put({ ...rec, evidence_file: f, writer_key: j.writer_key ?? null });
    } catch (e) { o.log?.(`credence: could not read rewrite evidence ${f}: ${e.message}`); }
  }

  function lastRewrite(c) {
    const touches = (r) => r.trigger?.claim_id === c.id || (r.sentences || []).some((s) => s.claim_id === c.id);
    const recs = rewrites.byPage(c.page, { history: true }).flatMap((p) => p.versions).filter(touches);
    const r = recs.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
    if (r) {
      const p = r.provenance || {};
      const anchorTx = r.anchor?.tx_hash || p.anchor?.tx_hash || null;
      return {
        id: r.id, version: r.version, status: r.status, model: p.model ?? null, signature: p.signature ?? null, signing_address: p.signing_address ?? null,
        signature_kind: p.signature_kind ?? null, verified: p.verified ?? null, request_hash: p.request_hash ?? null, response_hash: p.response_hash ?? null,
        signed_text: p.signed_text ?? null, prices_hash: r.prices_hash ?? null, anchor_tx: anchorTx, anchor_explorer: anchorTx ? explorerTx(config.network, anchorTx) : null,
        ...(r.writer_key === "test" ? { key_note: "Signed by the deployment's TEST writer key (services/ai's offline NEAR AI stand-in), not NEAR AI Cloud." } : {}),
        rewrites_url: `/rewrites?page=${encodeURIComponent(c.page)}`,
      };
    }
    // an anchor the scanner saw on chain, when no record is held here
    const ev = hub.since(0).filter((e) => e.event === "rewrite" && e.data?.claim_id === c.id).at(-1);
    if (ev) return { id: null, version: ev.data.version, status: "anchored", model: ev.data.model, signature: ev.data.signature, request_hash: ev.data.request_hash, response_hash: ev.data.response_hash, prices_hash: ev.data.prices_hash, anchor_tx: ev.txHash, anchor_explorer: explorerTx(config.network, ev.txHash) };
    return null;
  }

  async function rationalesOf(c) {
    let list = [];
    if (o.rationales) { try { list = await o.rationales(c.id); } catch { /* the AI layer is optional */ } }
    const seen = new Set(list.map((r) => `${r.account_id}:${r.at}`));
    for (const e of hub.since(0)) {
      if (e.event !== "agent_rationale" || e.data?.claim_id !== c.id) continue;
      const k = `${e.data.account_id}:${e.data.at}`;
      if (!seen.has(k)) { seen.add(k); list.push(e.data); }
    }
    return list.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, cc.rationalesPerClaim).map((r) => ({
      agent: r.agent ?? null, model: r.model ?? null, account_id: r.account_id ?? null, side: r.side ?? null, size_usd: r.size_usd ?? null,
      credence: r.credence ?? null, rationale: r.rationale, source_url: r.source_url ?? null, source_title: r.source_title ?? null,
      source_checked: r.source_checked ?? null, tx_hash: r.tx_hash ?? null, tx_explorer: r.tx_hash ? explorerTx(config.network, r.tx_hash) : null,
      at: r.at ? new Date(r.at).toISOString() : null,
    }));
  }

  function tradesOf(c) {
    return hub.since(0).filter((e) => e.event === "trade" && e.data?.claim_id === c.id).slice(-cc.tradesPerClaim).reverse().map((e) => ({
      side: e.data.side, amount_usd: usd(e.data.amount_micro), price_yes_after: e.data.price_yes_ppm / 1e6, trader: e.data.trader,
      tx_hash: e.txHash, tx_explorer: e.txHash ? explorerTx(config.network, e.txHash) : null, block: e.blockHeight ?? null,
    }));
  }

  async function challengeOf(c) {
    if (c.challenge_id === null || c.challenge_id === undefined) return null;
    try { return await rpc.viewFunction(config.marketId, "get_challenge", { challenge_id: c.challenge_id }, { timeoutMs: 2500 }); } catch { return null; }
  }

  async function describe(c, match) {
    const p = c.price_yes_ppm / 1e6;
    const up = usd(c.cost_up_10_micro), down = usd(c.cost_down_10_micro);
    const b = impliedB(p, up, down);
    const [rationales, challenge] = await Promise.all([rationalesOf(c), challengeOf(c)]);
    const resolution = resolutionOf(c, challenge);
    const oi = usd(c.open_interest_micro);
    const moves = [up ? `${money(up)} to push it 10 points up` : null, down ? `${money(down)} to push it 10 points down` : null].filter(Boolean).join(", ");
    return {
      claim_id: c.id, text: c.text, page: c.page, kind: c.kind,
      ...(match ? { match: { kind: match.kind, score: match.score, matched_terms: match.matched, missing_terms: match.missing } } : {}),
      credence: p,
      summary: resolution.state === "settled"
        ? `Settled ${resolution.outcome}.`
        : `The market prices this at ${pct(p)} true, with ${money(oi)} riding on it${moves ? `; it costs ${moves}` : ""}.`,
      price: { yes: p, no: Math.round((1 - p) * 1e6) / 1e6, yes_ppm: c.price_yes_ppm },
      open_interest_usd: oi, volume_usd: usd(c.volume_micro), trades: c.trades ?? null,
      cost_to_move_10_points: { up_usd: up, down_usd: down },
      liquidity_b_usd: b ? Math.round(b * 1e4) / 1e4 : null,
      rationales, ...(rationales.length ? {} : { rationales_note: "No agent has posted a rationale on this claim yet." }),
      recent_trades: tradesOf(c),
      resolution,
      provenance: {
        network: config.network, contract: config.marketId, claim_id: c.id,
        view: { method: "get_claim", args: { claim_id: c.id } },
        contract_explorer: `https://${config.network === "mainnet" ? "" : "testnet."}nearblocks.io/address/${config.marketId}`,
        last_rewrite: lastRewrite(c),
      },
    };
  }

  /**
   * @param {{ q?: string, claim?: number|null, page?: string|null, limit?: number, open?: boolean }} a
   * @param {string} ip
   */
  async function answer(a, ip) {
    if (!claims) return { status: 503, body: { error: { code: "market_not_configured", message: "MARKET_CONTRACT_ID is not set." } } };
    const base = { network: config.network, contract: config.marketId };
    if (a.claim !== null && a.claim !== undefined) {
      const c = await claims.one(a.claim);
      if (!c) return { status: 404, body: { error: { code: "no_such_claim", message: `No claim ${a.claim}.` } } };
      return { status: 200, body: { ...base, query: null, matched: 1, claims: [await describe(c)], as_of: new Date(now()).toISOString() } };
    }
    const list = await claims.all();
    const r = indexOf(list).search(a.q, { limit: a.limit, page: a.page });
    if (!r.matches.length) {
      const body = {
        ...base, query: a.q, matched: 0, claims: [],
        answer: "No claim on Priced In matches that, so no money stands behind any answer yet.",
        open: { how: "Open it: each priceable sentence below comes with a planner receipt that the market's open_and_buy accepts, or POST /paste to price your own wording.", result: null },
        as_of: new Date(now()).toISOString(),
      };
      if (a.open !== false && o.paste) {
        try { body.open.result = await o.paste({ text: a.q }, ip); }
        catch (e) { body.open.result = null; body.open.unavailable = e.message; }
      }
      return { status: 200, body };
    }
    const described = await Promise.all(r.matches.map((m) => describe(m.claim, m)));
    const top = described[0];
    return {
      status: 200,
      body: {
        ...base, query: a.q, matched: described.length,
        answer: `${top.match.kind === "exact" ? "Exactly this claim" : "The closest claim"}: "${top.text}" ${top.summary}`,
        claims: described, as_of: new Date(now()).toISOString(),
      },
    };
  }

  async function quote({ claim, side, amountUsd }) {
    if (!claims) return { status: 503, body: { error: { code: "market_not_configured", message: "MARKET_CONTRACT_ID is not set." } } };
    const c = await claims.one(claim);
    if (!c) return { status: 404, body: { error: { code: "no_such_claim", message: `No claim ${claim}.` } } };
    if (c.status === "Settled") return { status: 409, body: { error: { code: "claim_settled", message: "This claim is settled: it no longer trades." } } };
    try {
      const qt = quoteBuy(c, side, amountUsd);
      return {
        status: 200,
        body: {
          network: config.network, contract: config.marketId, text: c.text, quote: qt,
          call: { contract: config.marketId, method: "buy", args: { claim_id: c.id, side, amount_micro: qt.amount_micro, min_shares_micro: qt.min_shares_micro }, deposit: "0", gas_tgas: 30, note: "Your market balance pays. Deposit test USDC first with ft_transfer_call to the market (msg \"\")." },
        },
      };
    } catch (e) {
      return { status: 400, body: { error: { code: "bad_quote", message: e.message } } };
    }
  }

  return { answer, quote, describe };
}
