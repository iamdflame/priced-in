// Check 11: the real-money market's books and rulings, from mainnet itself, not from our site.
// Every read is pinned to one final block, so live trades can't split the books. Then:
//   books     the USDC the market holds against every bucket, every claim and every balance
//             (lib/books.mjs, the same reading as check 4), and the USDC token's own metadata;
//   rulings   every challenge from 0 to stats.challenges - 1: resolved, its claim Settled with
//             the outcome the verdicts and disputes give; every verdict's request hash equal to
//             sha256(canonical_request), its response and signature taken from the submit_verdict
//             transaction, sha256(response) = response_hash, ed25519 against get_model's key, and
//             the verdict the rules read from the response;
//   rewrite   one anchored mainnet rewrite (check 5's verification, on mainnet).
// tools/judge/evidence/mainnet-rulings.json holds only the transactions and their bytes, so
// --offline still checks the hashes and signatures.
//
// Why canonical_request still gives a settled verdict's request: build_request (contracts/market)
// reads the market's own account id, the challenge id, claim.text, the challenge's evidence, the
// model name, the model's extras and two constants (JURY_PROMPT, DEFAULT_MAX_TOKENS). None changes
// after settlement: claim.text and the evidence are written once (reopen makes a new claim), and
// only register_model changes a model's extras. Re-registering a model, or an upgrade that edits
// the prompt, would make this check FAIL, which is what it should then say.
import fs from "node:fs";
import path from "node:path";
import { booksAt } from "../lib/books.mjs";
import { verifyVerdict, submitVerdictArgs, expectedOutcome, pool } from "../lib/verdicts.mjs";
import { checkRewrite } from "./chain.mjs";

const XM = (kind, v) => `https://nearblocks.io/${kind}/${v}`;
export const RULINGS_EVIDENCE = "tools/judge/evidence/mainnet-rulings.json";
export const REWRITE_EVIDENCE = "tools/judge/evidence/rewrite-mainnet.json";
const SNAPSHOT = "node tools/judge/snapshot-mainnet-rulings.mjs";
const usdc = (micro) => (Number(BigInt(micro)) / 1e6).toFixed(Number(BigInt(micro)) % 1e6 === 0 ? 0 : 6);

function loadEvidence(repo) {
  const f = path.join(repo, RULINGS_EVIDENCE);
  if (!fs.existsSync(f)) return null;
  const ev = JSON.parse(fs.readFileSync(f, "utf8"));
  const by = new Map();
  for (const v of ev.verdicts || []) by.set(`${v.challenge_id}|${v.model}`, v);
  return { ev, by };
}

/** --offline: the recorded bytes against the keys deployments/mainnet.json records. */
async function offlineRulings(repo, mainnet, evidence) {
  const keys = new Map((mainnet.dep.models || []).map((m) => [m.model, m.signing_address_hex]));
  const bad = [];
  for (const v of evidence.ev.verdicts) {
    const r = verifyVerdict({ model: v.model, request: Buffer.from(v.request_b64 || "", "base64"), response: Buffer.from(v.response_b64 || "", "base64"), signatureHex: v.signature_hex, key: keys.get(v.model) });
    if (!r.ok) bad.push(`challenge ${v.challenge_id}, ${v.model}: ${r.steps.filter((s) => !s[1]).map((s) => s[0]).join("; ")}`);
  }
  return { bad, n: evidence.ev.verdicts.length, challenges: new Set(evidence.ev.verdicts.map((v) => v.challenge_id)).size };
}

/**
 * Pointers for verdicts newer than the evidence file: the site's /api/rulings gives only the
 * transaction hash; the bytes still come from the chain.
 */
async function sitePointers(site, fetchImpl) {
  const r = await fetchImpl(`${site.replace(/\/$/, "")}/api/rulings`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${site}/api/rulings: HTTP ${r.status}`);
  const by = new Map();
  for (const x of (await r.json()).rulings || []) for (const v of x.verdicts || []) if (v.tx) by.set(`${x.challenge_id}|${v.model}`, { tx_hash: v.tx, sender_id: null });
  return by;
}

export async function checkMainnet(repo, mainnet, { offline = false, site = "https://isitpriced.com", fetchImpl = globalThis.fetch } = {}) {
  if (!mainnet) return { status: "SKIP", detail: "no deployments/mainnet.json: there is no real-money deployment to read", see: "deployments/" };
  const M = mainnet.dep.accounts.market, USDC = mainnet.dep.accounts.usdc;
  const evidence = loadEvidence(repo);
  if (!evidence) return { status: "FAIL", detail: `${RULINGS_EVIDENCE} is missing`, see: SNAPSHOT };

  if (offline) {
    const o = await offlineRulings(repo, mainnet, evidence);
    const rw = await checkRewrite(repo, mainnet.dep, mainnet.rpc, { offline: true, evidence: REWRITE_EVIDENCE, explorer: XM });
    if (o.bad.length || rw.status !== "PASS") return { status: "FAIL", detail: [...o.bad, ...(rw.status !== "PASS" ? [`mainnet rewrite: ${rw.detail}`] : [])].join(" | "), see: RULINGS_EVIDENCE };
    return { status: "PASS", detail: `--offline: ${o.n} recorded verdicts on ${o.challenges} challenges: sha256 of each request and response, the ed25519 signature (keys as deployments/mainnet.json records them) and the verdict the rules read all verify; mainnet rewrite: ${rw.detail}. The books, the stored hashes and the outcomes were not read (chain not read: --offline)`, see: RULINGS_EVIDENCE };
  }

  const rpc = mainnet.rpc;
  const r = rpc.pinned(await rpc.finalHeight());
  const problems = [];

  // ---------- books ----------
  const k = await booksAt(r.view, M, USDC, { state: (prefix) => r.state(M, prefix) });
  if (!k.ok) problems.push(k.failed.join("; ") || (k.paused ? "the market is paused" : "no claims"));
  const meta = await r.view(USDC, "ft_metadata");
  const metaOk = meta?.symbol === "USDC" && meta?.decimals === 6;
  if (!metaOk) problems.push(`the token ${USDC} says ${meta?.symbol} with ${meta?.decimals} decimals, not USDC with 6`);

  // ---------- rulings ----------
  const n = Number(k.stats.challenges ?? 0);
  const keys = new Map();
  const keyOf = async (model) => { if (!keys.has(model)) keys.set(model, r.view(M, "get_model", { model }).then((m) => m?.signing_address_hex ?? null)); return keys.get(model); };
  const challenges = await pool(Array.from({ length: n }, (_, i) => i), 4, async (id) => {
    const ch = await r.view(M, "get_challenge", { challenge_id: id });
    const claim = ch ? await r.view(M, "get_claim", { claim_id: ch.claim_id }) : null;
    return { id, ch, claim };
  });
  let siteMap = null;
  const pointerOf = async (id, model) => {
    const e = evidence.by.get(`${id}|${model}`);
    if (e) return { ...e, from: "evidence" };
    siteMap ||= sitePointers(site, fetchImpl).catch(() => new Map());
    const s = (await siteMap).get(`${id}|${model}`);
    return s ? { ...s, from: "site" } : null;
  };

  const jobs = [];
  for (const c of challenges) for (const v of c.ch?.verdicts || []) jobs.push({ c, v });
  const checked = await pool(jobs, 4, async ({ c, v }) => {
    const ptr = await pointerOf(c.id, v.model);
    if (!ptr) return { c, v, missing: true };
    const tx = await rpc.tx(ptr.tx_hash, ptr.sender_id || M);
    const a = submitVerdictArgs(tx, M);
    const [canonical, key] = await Promise.all([r.view(M, "canonical_request", { challenge_id: c.id, model: v.model }), keyOf(v.model)]);
    const steps = [];
    if (!a) steps.push([`${ptr.tx_hash} holds a submit_verdict call to ${M}`, false]);
    else {
      steps.push([`${ptr.tx_hash} is challenge ${c.id} by ${v.model}`, a.challenge_id === c.id && a.model === v.model]);
      steps.push(["the market's receipt succeeded", a.ok]);
      if (ptr.response_b64) steps.push(["the recorded response and signature are the transaction's", Buffer.compare(a.response, Buffer.from(ptr.response_b64, "base64")) === 0 && a.signature_hex.toLowerCase() === String(ptr.signature_hex).toLowerCase()]);
      const res = verifyVerdict({ model: v.model, stored: v, canonical, request: ptr.request_b64 ? Buffer.from(ptr.request_b64, "base64") : null, response: a.response, signatureHex: a.signature_hex, key });
      steps.push(...res.steps);
    }
    return { c, v, ptr, failed: steps.filter((s) => !s[1]).map((s) => s[0]) };
  });

  let settled = 0, pending = 0, expired = 0, voided = 0, council = 0, right = 0, fromSite = 0, missing = 0;
  const stakesNote = [];
  for (const { id, ch, claim } of challenges) {
    if (!ch) { expired++; continue; } // expire_challenge drops the record: no quorum, the bond went back
    const extra = (ch.stakes || []).slice(1);
    if (extra.length) stakesNote.push(`challenge ${id}: ${extra.map((s) => `${usdc(s.amount_micro)} USDC on ${s.side ? "TRUE" : "FALSE"} by ${s.account}`).join(", ")}`);
    if (!ch.resolved) { pending++; continue; } // the jury is ruling or a dispute window is running
    if (claim?.challenge_id !== id) { voided++; continue; } // the council voided it and the claim reopened
    if (claim.status !== "Settled" || typeof claim.outcome !== "boolean") { problems.push(`challenge ${id} is resolved but claim ${ch.claim_id} is ${claim.status} with outcome ${claim.outcome}`); continue; }
    const want = expectedOutcome(ch.verdicts, ch.disputes);
    if (want === null && ch.disputes >= 3) council++;
    else if (want !== claim.outcome) { problems.push(`challenge ${id}: claim ${ch.claim_id} settled ${claim.outcome ? "TRUE" : "FALSE"}, the verdicts and ${ch.disputes} disputes give ${want === null ? "no outcome" : want ? "TRUE" : "FALSE"}`); continue; }
    settled++;
    if (ch.claimed_outcome === claim.outcome) right++;
  }
  for (const x of checked) {
    if (x.missing) { missing++; problems.push(`challenge ${x.c.id}, ${x.v.model}: no transaction pointer in ${RULINGS_EVIDENCE} or the site's /api/rulings`); continue; }
    if (x.ptr.from === "site") fromSite++;
    if (x.failed.length) problems.push(`challenge ${x.c.id}, ${x.v.model}: ${x.failed.join("; ")}`);
  }
  const verdicts = checked.length;
  const models = [...keys.keys()].map((m) => m.split("/").pop()).sort();

  // ---------- one anchored rewrite ----------
  const rw = await checkRewrite(repo, mainnet.dep, rpc, { offline: false, evidence: REWRITE_EVIDENCE, explorer: XM, blockId: r.blockId });
  if (rw.status !== "PASS") problems.push(`mainnet rewrite: ${rw.detail}`);

  const disputes = stakesNote.length ? `dispute stakes: ${stakesNote.join("; ")}` : `no disputes: each challenge holds only its challenger's bond`;
  const states = [pending && `${pending} still ruling or in a dispute window`, expired && `${expired} expired with no quorum (bond returned)`, voided && `${voided} voided by the council`, council && `${council} settled by the council`].filter(Boolean).join(", ");
  const detail = [
    `${M} at block ${r.blockId}: books close to the micro-USDC, USDC ${k.dollars} (${k.claims} claims; ${k.how})`,
    `${USDC.slice(0, 8)}… is ${meta?.symbol} with ${meta?.decimals} decimals`,
    `${settled} of ${n} challenges settled${states ? ` (${states})` : ""}, the challenger right on ${right}; ${verdicts} verdicts by ${models.length} models (${models.join(", ")}): each request hash = sha256(canonical_request), each response and signature taken from its submit_verdict transaction, sha256(response) = response_hash, ed25519 verifies against get_model's key, and the rules read the recorded verdict${fromSite ? ` (${fromSite} pointers from the site's /api/rulings, newer than ${RULINGS_EVIDENCE})` : ""}; each settled outcome is the one the verdicts and disputes give; ${disputes}`,
    `rewrite: ${rw.detail}`,
  ].join("; ");
  if (problems.length || n === 0) return { status: "FAIL", detail: `${problems.slice(0, 4).join(" | ") || "no challenges on mainnet"}${problems.length > 4 ? ` (+${problems.length - 4} more)` : ""} · ${detail}`, see: missing ? SNAPSHOT : XM("address", M) };
  return { status: "PASS", detail, see: XM("address", M) };
}
