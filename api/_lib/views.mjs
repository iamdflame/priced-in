// Read models for the read routes, over the indexed market events (events.jsonl), the signed
// rewrites, the agents' answers, the jury's runs and the chain's own views. Pure functions: the
// routes fetch, these shape. Every figure is from the chain's events or views; nothing here is
// estimated except a position's value at the current price, which says so.

export const P_MIN = 200_000, P_MAX = 800_000;
const clampP0 = (p) => Math.min(P_MAX, Math.max(P_MIN, Number(p)));
const usd = (micro) => Number(micro || 0) / 1e6;
const round = (x, d = 6) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);
export const timeOf = (e) => e.blockTimestampMs || e.seenAtMs || 0;
const nsToMs = (ns) => (ns === null || ns === undefined || ns === "0" || ns === 0 ? null : Math.floor(Number(BigInt(String(ns)) / 1_000_000n)));

/** Once per uid, oldest first (block time, height, then position in the receipt). */
export function chronological(events) {
  const seen = new Set();
  const out = [];
  for (const e of events || []) {
    if (!e || !e.event || (e.uid && seen.has(e.uid))) continue;
    if (e.uid) seen.add(e.uid);
    out.push(e);
  }
  const logIdx = (e) => Number(String(e.uid || "").split(":")[1] || 0);
  return out.sort((a, b) => timeOf(a) - timeOf(b) || (a.blockHeight || 0) - (b.blockHeight || 0) || String(a.txHash).localeCompare(String(b.txHash)) || logIdx(a) - logIdx(b));
}

// ---------- price history ----------

/**
 * Every claim's price path: the opening price, the price after each trade, the outcome at
 * settlement, and the price now from the snapshot. Map claim_id -> [[t_ms, price_yes_ppm], ...].
 */
export function priceHistory(events, claims = [], { at = Date.now() } = {}) {
  const series = new Map();
  const settled = new Set();
  const push = (id, pt) => {
    let s = series.get(id);
    if (!s) series.set(id, (s = []));
    const last = s.at(-1);
    if (last && last[0] === pt[0] && last[1] === pt[1]) return;
    s.push(pt);
  };
  for (const e of chronological(events)) {
    const id = e.data?.claim_id;
    if (!Number.isInteger(id)) continue;
    if (e.event === "open") push(id, [timeOf(e), clampP0(e.data.p0_ppm)]);
    else if (e.event === "trade" && Number.isFinite(e.data.price_yes_ppm)) push(id, [timeOf(e), e.data.price_yes_ppm]);
    else if (e.event === "settle") { push(id, [timeOf(e), e.data.outcome ? 1_000_000 : 0]); settled.add(id); }
  }
  for (const c of claims) {
    if (settled.has(c.id) || c.status === "Settled") continue;
    const s = series.get(c.id);
    if (!s?.length || s.at(-1)[1] !== c.price_yes_ppm) push(c.id, [at, c.price_yes_ppm]);
  }
  return series;
}

/** At most `max` points: the first, the last, and evenly spaced ones between. */
export function downsample(points, max = 32) {
  if (!Array.isArray(points) || points.length <= max) return points || [];
  const out = [points[0]];
  const step = (points.length - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) out.push(points[Math.round(i * step)]);
  out.push(points.at(-1));
  return out;
}

// ---------- portfolio ----------

const LANE_TRADER = /^lane:ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** A trader id as the market names it: lane:ed25519:<key> for a free-bet key, or a NEAR account. */
export function parseTrader(s) {
  const t = String(s ?? "").trim();
  if (LANE_TRADER.test(t)) return { trader: t, kind: "lane" };
  if (/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return { trader: `lane:${t}`, kind: "lane" };
  if (ACCOUNT.test(t)) return { trader: t, kind: "account" };
  return null;
}

/**
 * Positions, from the trader's own events (what was paid and received) and the chain's
 * get_position views (what is held now; the events stand in where a view could not be read).
 * @param {{ trader: string, kind: string, events: object[], claims: object[], positions?: Map<number, {yes_micro: string, no_micro: string}>, balanceMicro?: string|null }} a
 */
export function portfolioOf({ trader, kind, events, claims, positions = new Map(), balanceMicro = null }) {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const per = new Map(); // `${claim}|${side}` -> totals
  const slot = (id, side) => {
    const k = `${id}|${side}`;
    if (!per.has(k)) per.set(k, { claim_id: id, side, bought_micro: 0, spent_micro: 0, sold_micro: 0, proceeds_micro: 0, redeemed_shares_micro: 0, redeemed_micro: 0, trades: 0, first_at: null, last_at: null });
    return per.get(k);
  };
  let credit = 0, deposits = 0, withdrawals = 0, bonds = 0, bondsBack = 0;
  for (const e of chronological(events)) {
    const d = e.data || {};
    if (d.trader !== trader) continue;
    const t = timeOf(e);
    if (e.event === "trade") {
      const sell = String(d.side).startsWith("sell_");
      const s = slot(d.claim_id, sell ? d.side.slice(5) : d.side);
      if (sell) { s.sold_micro += Number(d.shares_micro); s.proceeds_micro += Number(d.amount_micro); }
      else { s.bought_micro += Number(d.shares_micro); s.spent_micro += Number(d.amount_micro); }
      s.trades++;
      s.first_at ??= t;
      s.last_at = t;
    } else if (e.event === "redeem") {
      const s = slot(d.claim_id, d.side);
      s.redeemed_shares_micro += Number(d.shares_micro);
      s.redeemed_micro += Number(d.amount_micro);
      s.last_at = t;
    } else if (e.event === "lane_credit") credit += Number(d.amount_micro);
    else if (e.event === "deposit") deposits += Number(d.amount_micro);
    else if (e.event === "withdraw") withdrawals += Number(d.amount_micro);
    else if (e.event === "challenge" || e.event === "dispute") bonds += Number(d.amount_micro);
    else if (e.event === "bond_paid" || e.event === "challenge_expired") bondsBack += Number(d.amount_micro);
  }
  // the chain's positions name claims the events may not have reached yet
  for (const [id, pos] of positions) for (const side of ["yes", "no"]) if (Number(pos?.[`${side}_micro`] || 0) > 0) slot(id, side);
  const rows = [];
  for (const s of per.values()) {
    const c = byId.get(s.claim_id) || null;
    const pos = positions.get(s.claim_id);
    const fromEvents = Math.max(0, s.bought_micro - s.sold_micro - s.redeemed_shares_micro);
    const held = pos ? Number(pos[`${s.side}_micro`] || 0) : fromEvents;
    const shares = held / 1e6;
    const priceYes = c ? c.price_yes_ppm / 1e6 : null;
    const sidePrice = priceYes === null ? null : s.side === "yes" ? priceYes : 1 - priceYes;
    const settled = c?.status === "Settled";
    const won = settled ? c.outcome === (s.side === "yes") : null;
    const value = settled ? (won ? shares : 0) : sidePrice === null ? null : shares * sidePrice;
    const spent = usd(s.spent_micro), got = usd(s.proceeds_micro) + usd(s.redeemed_micro);
    const state = settled
      ? (won ? (shares > 0 ? "won" : "collected") : "lost")
      : shares > 0 ? (c?.status === "Challenged" || c?.status === "Escalated" ? "ruling" : "open") : "closed";
    rows.push({
      claim_id: s.claim_id,
      text: c?.text ?? null,
      page: c?.page ?? null,
      side: s.side,
      shares: round(shares),
      avg_price: s.bought_micro > 0 ? round(s.spent_micro / s.bought_micro, 4) : null,
      spent_usd: round(spent),
      received_usd: round(got),
      price: sidePrice === null ? null : round(sidePrice, 4),
      value_usd: value === null ? null : round(value),
      value_basis: settled ? "the outcome: $1 a winning share" : "the current price (what the market would pay is a little less: selling moves it)",
      pnl_usd: value === null ? null : round(value + got - spent),
      status: c?.status ?? "unknown",
      outcome: c?.outcome ?? null,
      provisional: c?.provisional ?? null,
      state,
      redeemable: Boolean(settled && won && held > 0),
      redeem_usd: settled && won && held > 0 ? round(shares) : 0,
      trades: s.trades,
      first_at: s.first_at,
      last_at: s.last_at,
      held_from: pos ? "chain" : "events",
    });
  }
  rows.sort((a, b) => Number(b.redeemable) - Number(a.redeemable) || (b.last_at || 0) - (a.last_at || 0));
  const sum = (k) => round(rows.reduce((n, r) => n + (r[k] || 0), 0));
  return {
    trader,
    kind,
    balance_usd: balanceMicro === null ? null : usd(balanceMicro),
    free_bet: kind === "lane" ? { credit_usd: usd(credit), winnings_are: "score: a free bet's winnings stay in the market as score and can't be withdrawn" } : null,
    totals: { value_usd: sum("value_usd"), spent_usd: sum("spent_usd"), received_usd: sum("received_usd"), pnl_usd: sum("pnl_usd"), redeemable_usd: sum("redeem_usd"), positions: rows.filter((r) => r.shares > 0).length },
    flows: { deposits_usd: usd(deposits), withdrawals_usd: usd(withdrawals), bonds_posted_usd: usd(bonds), bonds_returned_usd: usd(bondsBack) },
    positions: rows,
  };
}

// ---------- activity ----------

/** Who a trader is, in a word a reader understands. */
export function whoIs(trader, names = new Map()) {
  if (!trader) return null;
  if (names.has(trader)) return names.get(trader);
  if (String(trader).startsWith("lane:")) return "a free $1 bet";
  if (String(trader).startsWith("checker.")) return "the Checker";
  return trader;
}

/** The latest trades, rewrites, agents' answers and rulings, newest first, in plain fields. */
export function activityOf({ events = [], rewrites = [], rationales = [], claims = [], names = new Map(), limit = 50 }) {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const text = (id) => byId.get(id)?.text ?? null;
  const out = [];
  for (const e of chronological(events)) {
    const d = e.data || {};
    const base = { at: timeOf(e), claim_id: d.claim_id ?? null, claim: text(d.claim_id), tx: e.txHash || null };
    if (e.event === "trade") {
      const sell = String(d.side).startsWith("sell_");
      out.push({ kind: "trade", ...base, who: whoIs(d.trader, names), trader: d.trader, action: sell ? "sell" : "buy", side: sell ? d.side.slice(5) : d.side, amount_usd: usd(d.amount_micro), shares: usd(d.shares_micro), price_after: d.price_yes_ppm / 1e6 });
    } else if (e.event === "open") {
      out.push({ kind: "market", ...base, what: "opened", price: clampP0(d.p0_ppm) / 1e6, liquidity_usd: usd(d.b_micro) });
    } else if (e.event === "challenge") {
      out.push({ kind: "ruling", stage: "challenged", ...base, challenge_id: d.challenge_id, who: whoIs(d.trader, names), claimed: d.claimed ? "true" : "false", bond_usd: usd(d.amount_micro) });
    } else if (e.event === "verdict") {
      out.push({ kind: "ruling", stage: "verdict", ...base, challenge_id: d.challenge_id, model: d.model, verdict: d.outcome });
    } else if (e.event === "provisional") {
      out.push({ kind: "ruling", stage: "provisional", ...base, challenge_id: d.challenge_id, outcome: d.outcome ? "true" : "false", window_ends_at: nsToMs(d.window_ends_ns) });
    } else if (e.event === "dispute") {
      out.push({ kind: "ruling", stage: "disputed", ...base, challenge_id: d.challenge_id, who: whoIs(d.trader, names), bond_usd: usd(d.amount_micro), proposed: d.proposed ? "true" : "false" });
    } else if (e.event === "settle") {
      out.push({ kind: "ruling", stage: "settled", ...base, challenge_id: d.challenge_id, outcome: d.outcome ? "true" : "false", payout_usd: usd(d.payout_micro) });
    } else if (e.event === "challenge_expired") {
      out.push({ kind: "ruling", stage: "expired", ...base, challenge_id: d.challenge_id });
    } else if (e.event === "redeem") {
      out.push({ kind: "collect", ...base, who: whoIs(d.trader, names), trader: d.trader, side: d.side, amount_usd: usd(d.amount_micro) });
    }
  }
  for (const r of rewrites) {
    if (r.status !== "signed") continue;
    const id = r.trigger?.claim_id ?? r.sentences?.[0]?.claim_id ?? null;
    const s = r.sentences?.find((x) => x.claim_id === id) || r.sentences?.[0];
    out.push({ kind: "rewrite", at: r.createdAt || r.updatedAt || 0, claim_id: id, claim: text(id) ?? s?.claim ?? null, id: r.id, page: r.page, band: s?.band ?? null, sentence: s?.text ?? null, model: r.provenance?.model ?? null, anchor_tx: r.anchor?.status === "anchored" ? r.anchor.tx_hash : null, tx: r.trigger?.txHash ?? null });
  }
  for (const a of rationales) {
    out.push({ kind: "answer", at: a.at || 0, claim_id: a.claim_id, claim: text(a.claim_id), who: a.agent, model: a.model, action: a.side, text: a.text, rationale: a.rationale, reason: a.policy?.reason ?? null, credence: a.credence, source_url: a.source_url, trigger: a.trigger?.kind ?? null, tx: a.tx_hash || null });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

// ---------- rulings ----------

const OUTCOME = (b) => (b === true ? "TRUE" : b === false ? "FALSE" : null);

/**
 * Every challenge, live and past: the per-model verdicts and how each signature was checked,
 * the dispute window, the disputes, the outcome and the market that opened in its place.
 * @param {{ events: object[], claims: object[], live?: Map<number, object>, windowEnds?: Map<number, string|null>, juryRuns?: object[], links?: object[], names?: Map<string,string> }} a
 */
export function rulingsOf({ events = [], claims = [], live = new Map(), windowEnds = new Map(), juryRuns = [], links = [], names = new Map() }) {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const recs = new Map();
  const get = (id) => recs.get(id);
  const blank = (id, claimId) => ({
    challenge_id: id, claim_id: claimId, claim: byId.get(claimId)?.text ?? null, page: byId.get(claimId)?.page ?? null,
    challenger: null, challenger_name: null, claimed: null, bond_usd: null, opened_at: null, open_tx: null, jury_deadline_at: null, evidence: null,
    verdicts: [], provisional: null, provisional_at: null, window_ends_at: null, disputes: [], escalated: false,
    status: "jury", outcome: null, settled_at: null, settle_tx: null, payout_usd: null, bonds: [], expired_at: null, correction: null,
  });
  const ordered = chronological(events);
  // 1. every challenge the index or the chain knows; the index can be behind the chain, either way
  for (const e of ordered) {
    if (e.event !== "challenge") continue;
    const d = e.data || {};
    recs.set(d.challenge_id, Object.assign(blank(d.challenge_id, d.claim_id), {
      challenger: d.trader, challenger_name: whoIs(d.trader, names), claimed: OUTCOME(d.claimed), bond_usd: usd(d.amount_micro),
      opened_at: timeOf(e), open_tx: e.txHash || null, jury_deadline_at: nsToMs(d.jury_deadline_ns),
    }));
  }
  for (const [id, ch] of live) {
    if (!ch || recs.has(id)) continue;
    recs.set(id, Object.assign(blank(id, ch.claim_id), {
      challenger: ch.challenger, challenger_name: whoIs(ch.challenger, names), claimed: OUTCOME(ch.claimed_outcome), bond_usd: usd(ch.stakes?.[0]?.amount_micro),
      opened_at: nsToMs(ch.opened_ns), jury_deadline_at: nsToMs(ch.jury_deadline_ns),
    }));
  }
  // 2. what happened to each, in order
  for (const e of ordered) {
    const d = e.data || {};
    const t = timeOf(e);
    if (e.event === "challenge") continue;
    const r = Number.isInteger(d.challenge_id) ? get(d.challenge_id) : null;
    if (!r) continue;
    if (e.event === "verdict") {
      if (!r.verdicts.some((v) => v.model === d.model)) r.verdicts.push({ model: d.model, verdict: d.outcome, at: t, tx: e.txHash || null, signature: "verified on-chain: the market checked it against the model's registered key" });
    } else if (e.event === "provisional") {
      r.provisional = OUTCOME(d.outcome); r.provisional_at = t; r.window_ends_at = nsToMs(d.window_ends_ns); r.status = "window";
    } else if (e.event === "dispute") {
      r.disputes.push({ who: whoIs(d.trader, names), trader: d.trader, bond_usd: usd(d.amount_micro), round: d.round, proposed: OUTCOME(d.proposed), at: t, tx: e.txHash || null });
      r.provisional = OUTCOME(d.proposed); r.window_ends_at = nsToMs(d.window_ends_ns); r.status = "window";
    } else if (e.event === "escalate") { r.escalated = true; r.status = "escalated"; }
    else if (e.event === "settle") { r.outcome = OUTCOME(d.outcome); r.settled_at = t; r.settle_tx = e.txHash || null; r.payout_usd = usd(d.payout_micro); r.status = "settled"; }
    else if (e.event === "bond_paid") r.bonds.push({ who: whoIs(d.trader, names), trader: d.trader, paid_usd: usd(d.amount_micro), tx: e.txHash || null });
    else if (e.event === "bond_forfeit") r.bonds.push({ who: "the treasury", forfeit_usd: usd(d.amount_micro), tx: e.txHash || null });
    else if (e.event === "challenge_expired") { r.status = "expired"; r.expired_at = t; r.settle_tx = e.txHash || null; }
    else if (e.event === "void") { r.status = "void"; r.settled_at = t; }
  }
  // 3. the chain's own view: it wins for a challenge still running, and settles one the index has
  //    not reached yet (a settled claim keeps its challenge id and its outcome)
  for (const [id, ch] of live) {
    if (!ch) continue;
    const r = get(id);
    const claim = byId.get(ch.claim_id);
    r.evidence = ch.evidence ?? r.evidence;
    for (const v of ch.verdicts || []) {
      const have = r.verdicts.find((x) => x.model === v.model);
      if (have) Object.assign(have, { request_hash: v.request_hash, response_hash: v.response_hash });
      else r.verdicts.push({ model: v.model, verdict: v.outcome, at: null, tx: null, request_hash: v.request_hash, response_hash: v.response_hash, signature: "verified on-chain: the market checked it against the model's registered key" });
    }
    if (!ch.resolved && claim) {
      r.provisional = OUTCOME(claim.provisional);
      if (claim.status === "Escalated") { r.status = "escalated"; r.escalated = true; }
      else if (claim.provisional !== null && claim.provisional !== undefined) r.status = "window";
      const end = windowEnds.get(id);
      if (end) r.window_ends_at = nsToMs(end);
    } else if (ch.resolved && r.status !== "settled" && r.status !== "void") {
      if (claim?.status === "Settled" && claim.challenge_id === id) { r.status = "settled"; r.outcome = OUTCOME(claim.outcome); }
      else if (claim && claim.challenge_id !== id) r.status = "void";
    }
    r.disputes_on_chain = ch.disputes ?? r.disputes.length;
  }
  // what the jury's runner saw: each model's attestation and its own check of the signature
  for (const run of juryRuns) {
    const r = get(run.challenge_id);
    if (!r) continue;
    for (const j of run.jurors || []) {
      if (j.status === "already_ruled") continue; // a later run found this model's verdict on-chain
      if (j.status === "failed" && /already ruled/.test(j.error || "")) continue; // a retry that lost to its own late verdict
      let v = r.verdicts.find((x) => x.model === j.model);
      if (!v) { v = { model: j.model, verdict: null, at: null, tx: null, signature: null }; r.verdicts.push(v); }
      if (v.runner?.status === "submitted") continue; // a later run's retry says nothing new about it
      v.runner = { status: j.status, verdict: j.outcome ?? null, error: j.error ?? null, signing_address: j.signing_address ?? null, signature_kind: j.signature_kind ?? null, attestation: j.attestation ?? null, tx: j.tx_hash ?? null, at: run.at ?? null };
      v.tx ??= j.tx_hash ?? null;
      if (!v.signature) v.signature = j.status === "submitted" ? "verified by the runner; on-chain record pending" : j.status === "unverified" ? `not verified: ${j.error || "the signature did not match the attested key"}` : j.status ? `no verdict: ${j.error || j.status}` : null;
    }
  }
  for (const l of links) {
    const r = get(l.challenge_id) || [...recs.values()].find((x) => x.claim_id === l.old_claim_id && x.status === "settled");
    if (r) r.correction = { claim_id: l.new_claim_id, text: l.text, open_tx: l.open_tx ?? null, rewrite_id: l.rewrite_id ?? null, at: l.at ?? null };
  }
  const list = [...recs.values()];
  for (const r of list) {
    if (r.status === "jury" && r.jury_deadline_at && r.jury_deadline_at < Date.now() && !r.provisional) r.stage_note = "the jury deadline passed with no two matching verdicts: anyone can call expire_challenge, which refunds the bond and reopens the line";
  }
  const liveFirst = (r) => (["jury", "window", "escalated"].includes(r.status) ? 1 : 0);
  return list.sort((a, b) => liveFirst(b) - liveFirst(a) || (b.opened_at || 0) - (a.opened_at || 0));
}
