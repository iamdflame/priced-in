// Shared by scripts/measure-scout.mjs and scripts/measure-news-settle.mjs: the NEAR AI client on
// NEARAI_API_KEY1 (from .env, never printed) with a running cost at the live /v1/models prices and
// $0.005 a web search, read-only views of the mainnet market, and the jury's exact request.
// Nothing here signs, posts or spends anything but model calls.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NearAI } from "../services/ai/src/nearai.js";
import { reserveFromState, spareNearOf } from "../services/ai/src/gate.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
export const MARKET = "market.isitpriced.near";
export const RPCS = ["https://free.rpc.fastnear.com", "https://near.drpc.org", "https://rpc.mainnet.near.org"];
const lib = fs.readFileSync(path.join(ROOT, "contracts/market/src/lib.rs"), "utf8");
export const JURY_PROMPT = /const JURY_PROMPT: &str = "(.*)";/.exec(lib)[1];
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/mainnet.json"), "utf8"));
export const JURY_MODELS = dep.models.map((m) => ({ model: m.model, extras: JSON.parse(`{${m.extras_json || ""}}`) }));
export const SEARCH_USD = 0.005; // /v1/services: web_search, 5,000,000 nano-USD a request

/** A NEAR AI client that keeps a running cost, and refuses to go past `budgetUsd`. */
export async function meteredClient({ budgetUsd = 2, key = env.NEARAI_API_KEY1 } = {}) {
  if (!key) throw new Error("NEARAI_API_KEY1 is not set in .env");
  const prices = Object.fromEntries(((await (await fetch("https://cloud-api.near.ai/v1/models")).json()).data || []).map((m) => [m.id, m.pricing]));
  const client = new NearAI({ apiKey: key, timeoutMs: 120_000 });
  const spend = { usd: 0, calls: 0, searches: 0, byPurpose: {} };
  const charge = (purpose, model, usage, request, content, search) => {
    const p = prices[model] || {};
    const inTok = usage?.prompt_tokens ?? Math.ceil(String(request).length / 4);
    const outTok = usage?.completion_tokens ?? Math.ceil(String(content || "").length / 4);
    const usd = inTok * Number(p.prompt || 0.000001) + outTok * Number(p.completion || 0.000002) + (search ? SEARCH_USD : 0);
    spend.usd += usd; spend.calls++; if (search) spend.searches++;
    spend.byPurpose[purpose] = (spend.byPurpose[purpose] || 0) + usd;
  };
  const guard = () => { if (spend.usd >= budgetUsd) throw new Error(`the measurement's budget of $${budgetUsd} is spent`); };
  const wrap = (purpose) => ({
    hasKey: true,
    chat: async (body, o) => { guard(); const r = await client.chat(body, o); charge(purpose, r.model || body.model, r.usage, JSON.stringify(body), r.content, false); return r; },
    chatStream: async (body, o) => { guard(); const r = await client.chatStream(body, o); charge(purpose, body.model, r.usage, JSON.stringify(body), r.content, (body.tools || []).length > 0); return r; },
    signature: (...a) => client.signature(...a),
    model: (...a) => client.model(...a),
    models: (...a) => client.models(...a),
    attestationReport: (...a) => client.attestationReport(...a),
    get apiKey() { return client.apiKey; },
    get baseUrl() { return client.baseUrl; },
  });
  return { client, wrap, spend };
}

/** One view call on the mainnet market, raced across RPCs. */
export async function view(method, args = {}, { finality = "final" } = {}) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality, account_id: MARKET, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }), signal: AbortSignal.timeout(10_000) });
      const j = await r.json();
      if (j.result?.result) return JSON.parse(Buffer.from(j.result.result).toString("utf8"));
      last = new Error(JSON.stringify(j.error || j).slice(0, 200));
    } catch (e) { last = e; }
  }
  throw last;
}

/** The market's money: stats, and the reserve cap from its raw STATE. */
export async function capacity() {
  const stats = await view("stats");
  let st = null;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_state", finality: "final", account_id: MARKET, prefix_base64: Buffer.from("STATE").toString("base64") } }), signal: AbortSignal.timeout(10_000) });
      const j = await r.json();
      const v = (j.result?.values || []).find((x) => Buffer.from(x.key, "base64").toString() === "STATE");
      if (v) { st = reserveFromState(Buffer.from(v.value, "base64")); break; }
    } catch { /* next */ }
  }
  const acct = await fetch(RPCS[0], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: MARKET } }), signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).then((j) => j.result).catch(() => null);
  return { stats, capacity: st ? { treasuryMicro: stats.treasury_micro, reservedMicro: stats.reserved_micro, capMicro: st.capMicro, laneBudgetMicro: stats.lane_budget_micro, spareNear: acct ? spareNearOf(acct) : null } : null };
}

/** Every claim on the mainnet market. */
export async function allClaims() {
  const out = [];
  for (let from = 0; ; from += 100) {
    const page = await view("get_claims", { from, limit: 100 });
    out.push(...page);
    if (page.length < 100) return out;
  }
}

/** The jury's verdict on one claim and evidence, exactly as build_request sends it: two of three matching make the panel. */
export async function juryPanel(client, { claim, evidence, n = 900 }) {
  const parse = (content) => /^VERDICT: (TRUE|FALSE|INSUFFICIENT)$/.exec(String(content ?? "").split("\n").map((l) => l.trim()).find((l) => l) ?? "")?.[1] ?? "UNPARSEABLE";
  const votes = await Promise.all(JURY_MODELS.map(async ({ model, extras }) => {
    const user = `Market ${MARKET} challenge ${n}.\nClaim: ${claim}\nEvidence (untrusted): ${evidence}`;
    const body = { model, messages: [{ role: "system", content: JURY_PROMPT }, { role: "user", content: user }], temperature: 0, ...(extras.max_tokens ? {} : { max_tokens: 1024 }), ...extras, stream: false };
    try { const r = await client.chat(body, { timeoutMs: 120_000 }); return { model, verdict: parse(r.content), text: String(r.content || "").trim().slice(0, 300) }; }
    catch (e) { return { model, verdict: "ERROR", text: String(e.message).slice(0, 200) }; }
  }));
  let panel = "NO QUORUM";
  for (const v of ["TRUE", "FALSE"]) if (votes.filter((x) => x.verdict === v).length >= 2) panel = v;
  return { panel, votes };
}

export const write = (rel, obj) => { fs.mkdirSync(path.dirname(path.resolve(ROOT, rel)), { recursive: true }); fs.writeFileSync(path.resolve(ROOT, rel), JSON.stringify(obj, null, 1) + "\n"); return rel; };
