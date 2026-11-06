// Records one complete real run, for the site to replay: a hero line's bet, the signed rewrite that
// bet caused, an agent's answer to it, and the ruling on that line once there is one (the challenge,
// each model's signed verdict, the dispute window, the finalize, the payouts, and the corrected line
// that opened in its place). Every transaction in it is read back from the chain it happened on.
//
//   node scripts/rehearsal/record.mjs                                   mainnet, from https://isitpriced.com/api
//   node scripts/rehearsal/record.mjs --claim 18 --out <file>
//   node scripts/rehearsal/record.mjs --network testnet --store <dir>   testnet, from a local store (STATE_DIR)
//
// A record keeps its network and that network's RPCs, so a testnet record is verified against
// testnet and never shows red on a mainnet page. Reads only: no key, no transaction.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractMarketEvents } from "../../services/api/src/events.mjs";
import { verifyProvenance } from "../../services/ai/src/nearai.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const NET = arg("--network", "mainnet");
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, `deployments/${NET}.json`), "utf8"));
const MARKET = dep.accounts.market;
const RPCS = NET === "mainnet" ? ["https://rpc.fastnear.com", "https://near.drpc.org", "https://free.rpc.fastnear.com"] : ["https://near-testnet.drpc.org", "https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com"];
const EXPLORER = NET === "mainnet" ? "https://nearblocks.io/txns/" : "https://testnet.nearblocks.io/txns/";
const OUT = arg("--out", path.join(ROOT, `deployments/rehearsal/${NET}.json`));

async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
      const j = await r.json();
      if (j.error) throw Object.assign(new Error(JSON.stringify(j.error).slice(0, 300)), { chain: true });
      return j.result;
    } catch (e) { last = e; }
  }
  throw last;
}
const view = async (method, args) => JSON.parse(Buffer.from((await rpc("query", { request_type: "call_function", finality: "final", account_id: MARKET, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") })).result).toString("utf8"));

/** A transaction read back from its own chain: it landed, and these are the market events it made. */
async function onChain(tx, signer) {
  if (!tx) return null;
  try {
    const r = await rpc("EXPERIMENTAL_tx_status", { tx_hash: tx, sender_account_id: signer, wait_until: "NONE" });
    const ok = r.status && "SuccessValue" in r.status;
    const b = await rpc("block", { block_id: r.transaction_outcome.block_hash });
    return { tx, network: NET, signer: r.transaction?.signer_id ?? signer, receiver: r.transaction?.receiver_id ?? null, ok, block_height: b.header.height, block_time: new Date(Math.floor(Number(b.header.timestamp_nanosec) / 1e6)).toISOString(), events: extractMarketEvents(r, MARKET).map((e) => ({ event: e.event, data: e.data })), link: EXPLORER + tx };
  } catch (e) { return { tx, network: NET, ok: false, error: e.message.slice(0, 200), link: EXPLORER + tx }; }
}

// ---------- the data: the hosted API, or a local store ----------

async function fromApi(base) {
  const get = async (p) => { const r = await fetch(`${base}${p}`, { signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json(); };
  const claims = (await get("/claims")).claims;
  const pages = [...new Set(claims.map((c) => c.page))];
  const rewrites = [];
  for (const pg of pages) for (const para of (await get(`/rewrites?page=${pg}&history=1`)).rewrites) rewrites.push(...(para.versions || [para.latest]));
  const rationales = (await get("/rationales?since=0")).rationales;
  const activity = (await get("/activity?limit=200").catch(() => ({ activity: [] }))).activity;
  const rulings = await get("/rulings").catch(() => ({ rulings: [] }));
  return { claims, rewrites, rationales, trades: activity.filter((a) => a.kind === "trade").map((a) => ({ claim_id: a.claim_id, trader: a.trader, side: a.side, action: a.action, amount_usd: a.amount_usd, price_after: a.price_after, tx: a.tx, at: a.at })), rulings: rulings.rulings || [], source: base };
}

async function fromStore(dir) {
  process.env.STATE_DIR = dir;
  const { FsState, JournalDir } = await import("../../api/_lib/store.mjs");
  const { rulingsOf, activityOf } = await import("../../api/_lib/views.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-rehearsal-"));
  const j = new JournalDir(new FsState({ prefix: `state/${NET}/${MARKET}`, dir }), tmp);
  await j.hydrate();
  const claims = await view("get_claims", { from: 0, limit: 100 });
  const latest = new Map();
  for (const r of j.read("rewrites.jsonl")) latest.set(r.id, r);
  const events = j.read("events.jsonl");
  const live = new Map();
  for (const c of claims) if (Number.isInteger(c.challenge_id)) live.set(c.challenge_id, await view("get_challenge", { challenge_id: c.challenge_id }).catch(() => null));
  const rulings = rulingsOf({ events, claims, live, juryRuns: j.read("jury.jsonl"), links: j.read("links.jsonl") });
  const trades = activityOf({ events, claims, limit: 5000 }).filter((a) => a.kind === "trade").map((a) => ({ claim_id: a.claim_id, trader: a.trader, side: a.side, action: a.action, amount_usd: a.amount_usd, price_after: a.price_after, tx: a.tx, at: a.at }));
  return { claims, rewrites: [...latest.values()], rationales: j.read("rationales.jsonl"), trades, rulings, source: `local store ${dir}` };
}

const data = arg("--store") ? await fromStore(arg("--store")) : await fromApi(arg("--api", "https://isitpriced.com/api"));

// ---------- the run ----------

// newest first, a rewrite a bet caused before one a ruling asked for
const signedFor = (id) => data.rewrites.filter((r) => r.status === "signed" && r.sentences?.some((s) => s.claim_id === id)).sort((a, b) => Number(Boolean(b.trigger?.txHash)) - Number(Boolean(a.trigger?.txHash)) || (b.createdAt || 0) - (a.createdAt || 0));
const pick = arg("--claim");
const hero = pick !== undefined ? Number(pick)
  : (data.rulings.find((r) => r.status === "settled" && signedFor(r.claim_id).length)?.claim_id
    ?? data.claims.find((c) => signedFor(c.id).some((r) => r.sentences.find((s) => s.claim_id === c.id)?.band === "correct"))?.id
    ?? data.claims.find((c) => signedFor(c.id).length)?.id);
if (hero === undefined || Number.isNaN(hero)) { console.error("no line has a signed rewrite caused by a bet yet: nothing to record"); process.exit(2); }
const claim = data.claims.find((c) => c.id === hero);
const rewrite = signedFor(hero).find((r) => r.trigger.claim_id === hero) || signedFor(hero)[0];
if (!rewrite) { console.error(`claim ${hero} has no signed rewrite caused by a bet yet`); process.exit(2); }
const newestBet = data.trades.filter((t) => t.claim_id === hero).sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
const betTx = rewrite.trigger?.txHash || newestBet?.tx || null;
const trade = data.trades.find((t) => t.tx === betTx) || null;
const answer = data.rationales.filter((a) => betTx && a.trigger?.tx_hash === betTx).sort((a, b) => (a.at || 0) - (b.at || 0))[0]
  || data.rationales.filter((a) => a.claim_id === hero).sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
const ruling = data.rulings.filter((r) => r.claim_id === hero).sort((a, b) => (b.opened_at || 0) - (a.opened_at || 0))[0] || null;

const bettor = trade?.trader ?? rewrite.trigger?.trader ?? null;
const bet = await onChain(betTx, !bettor || bettor.startsWith("lane:") ? dep.accounts.lane : bettor);
const betEvent = bet?.events?.find((e) => e.event === "trade" && e.data.claim_id === hero) || null;
const anchor = rewrite.anchor?.tx_hash ? await onChain(rewrite.anchor.tx_hash, dep.root) : null;
const answerTx = answer?.tx_hash ? await onChain(answer.tx_hash, answer.account_id) : null;
const sig = verifyProvenance(rewrite.provenance);
const steps = [
  {
    kind: "bet", at: bet?.block_time ? Date.parse(bet.block_time) : rewrite.createdAt, claim_id: hero,
    trader: betEvent?.data?.trader ?? bettor, free_bet: String(betEvent?.data?.trader ?? bettor ?? "").startsWith("lane:"),
    side: betEvent?.data?.side ?? null, amount_usd: betEvent ? Number(betEvent.data.amount_micro) / 1e6 : null, shares: betEvent ? Number(betEvent.data.shares_micro) / 1e6 : null,
    price_after: betEvent ? betEvent.data.price_yes_ppm / 1e6 : (rewrite.trigger?.price_yes_ppm ?? 0) / 1e6, chain: bet,
  },
  {
    kind: "rewrite", at: rewrite.createdAt, signed_after_ms: rewrite.latency_ms?.signed ?? null, id: rewrite.id, status: rewrite.status,
    sentence: rewrite.sentences.find((s) => s.claim_id === hero), previous_text: rewrite.previous_text, text: rewrite.text, diff: rewrite.diff,
    signature: { verifies: sig.ok, reasons: sig.reasons, model: rewrite.provenance.model, signing_address: rewrite.provenance.signing_address, expected_signer: rewrite.provenance.expected_signer },
    record: rewrite, anchor,
  },
  answer && { kind: "answer", at: answer.at, agent: answer.agent, persona: answer.persona, model: answer.model, action: answer.side, text: answer.text, credence: answer.credence, rationale: answer.rationale, source_url: answer.source_url, policy: answer.policy, signature: answer.provenance?.status ?? null, record: answer, chain: answerTx },
  ruling
    ? { kind: "ruling", at: ruling.opened_at, record: ruling, chain: { challenge: await onChain(ruling.open_tx, ruling.challenger), verdicts: await Promise.all(ruling.verdicts.filter((v) => v.tx).map(async (v) => ({ model: v.model, verdict: v.verdict, chain: await onChain(v.tx, dep.root) }))), finalize: await onChain(ruling.settle_tx, dep.root), correction: ruling.correction?.open_tx ? await onChain(ruling.correction.open_tx, dep.root) : null } }
    : { kind: "ruling", at: null, record: null, note: "no ruling on this line yet: the Checker challenges one caught line at a time; record again once it settles" },
].filter(Boolean);
const bad = [bet, anchor, answerTx].filter((x) => x && !x.ok).map((x) => `${x.tx}: ${x.error || "failed on-chain"}`);
const out = {
  schema: "pricedin.rehearsal/1",
  note: `One complete real run on NEAR ${NET}, recorded from ${data.source} and read back from the chain. Replay it in order; every transaction carries its network and links, so a ${NET} record is checked against ${NET}.`,
  network: NET, market: MARKET, rpc: RPCS, explorer: EXPLORER, recorded_at: new Date().toISOString(),
  claim: claim ? { id: claim.id, text: claim.text, page: claim.page, kind: claim.kind, status: claim.status, outcome: claim.outcome, price_yes_ppm: claim.price_yes_ppm, trades: claim.trades } : { id: hero },
  timings_ms: { bet_to_rewrite_signed: rewrite.trigger?.txHash ? rewrite.latency_ms?.signed ?? null : null, bet_to_answer: answer && steps[0].at ? answer.at - steps[0].at : null, challenge_to_provisional: ruling?.provisional_at && ruling.opened_at ? ruling.provisional_at - ruling.opened_at : null, challenge_to_settled: ruling?.settled_at && ruling.opened_at ? ruling.settled_at - ruling.opened_at : null },
  steps,
  verify: { transactions: "EXPERIMENTAL_tx_status on the record's own network (rpc above)", rewrite: "sha256 of request_b64 and response_b64, then ed25519 over <model>:<request_hash>:<response_hash> against the attested signing key (services/ai/src/nearai.js verifyProvenance)", verdicts: "the market verified each model's signature on-chain when it accepted the verdict" },
  problems: bad,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`recorded claim ${hero} on ${NET}: bet ${bet?.tx?.slice(0, 10)}… ${bet?.ok ? "on-chain" : "NOT FOUND"}, rewrite ${rewrite.id} ${sig.ok ? "signature verifies" : `signature: ${sig.reasons.join("; ")}`}, anchor ${anchor ? (anchor.ok ? "on-chain" : "NOT FOUND") : "none"}, answer ${answer ? `${answer.agent} ${answer.side}` : "none"}, ruling ${ruling ? `${ruling.status}${ruling.outcome ? ` ${ruling.outcome}` : ""}` : "none yet"} -> ${path.relative(ROOT, OUT)}`);
// the site replays a copy of the mainnet record: keep it in step (a --out elsewhere, or testnet, is not that record)
if (path.resolve(OUT) === path.join(ROOT, "deployments/rehearsal/mainnet.json")) {
  const { siteData } = await import("../sync-site-data.mjs");
  for (const [p, body] of Object.entries(siteData(ROOT))) fs.writeFileSync(path.join(ROOT, p), body);
  console.log("synced site/data from deployments/");
}
process.exit(bad.length ? 1 : 0);
