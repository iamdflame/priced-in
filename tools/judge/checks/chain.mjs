// Checks 3, 4 and 5: the contracts on testnet (and the real-money market on mainnet) are the
// source in this repo, their books close, and a recorded signed rewrite verifies from its own
// bytes and is anchored on-chain.
import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { marketEvents } from "../lib/near.mjs";
import { reproBuild } from "../lib/repro.mjs";

const X = (kind, v) => `https://testnet.nearblocks.io/${kind}/${v}`;

// ---------- 3. reproducible contracts ----------
export async function checkRepro(repo, dep, rpc, { offline, build, mainnet = null }) {
  const r = await build; // started early: the build runs while the other checks do
  if (!r.ok) {
    if (/--no-build/.test(r.reason)) return { status: "SKIP", detail: "--no-build: the contracts were not rebuilt", see: "npm run judge (without --no-build)" };
    if (/not installed|needs rustc|wasm32/.test(r.reason)) return { status: "SKIP", detail: `${r.reason}, so nothing was built`, see: "rustup toolchain install 1.99.1 --target wasm32-unknown-unknown, then npm run judge (or node tools/judge/repro.mjs)" };
    return { status: "FAIL", detail: r.reason, see: "node tools/judge/repro.mjs" };
  }
  const want = { market: dep.code.market.code_hash, swarm: dep.code.swarm.code_hash };
  let live = null;
  if (!offline) live = { market: (await rpc.account(dep.accounts.market)).code_hash, swarm: (await rpc.account(dep.accounts.swarm)).code_hash };
  const got = { market: r.wasm.market.hash, swarm: r.wasm.swarm.hash };
  const agentOk = r.wasm.agent.bytes.equals(fs.readFileSync(path.join(repo, "contracts/swarm/res/agent.wasm")));
  const against = live || want;
  const ok = got.market === against.market && got.swarm === against.swarm && agentOk && (!live || (live.market === want.market && live.swarm === want.swarm));
  const where = live ? "the code on testnet" : "the code hashes recorded in deployments/testnet.json (chain not read: --offline)";
  if (!ok) return { status: "FAIL", detail: `built market ${got.market}, swarm ${got.swarm}; ${live ? "testnet has" : "recorded"} market ${against.market}, swarm ${against.swarm}${agentOk ? "" : "; the agent wallet doesn't rebuild to contracts/swarm/res/agent.wasm"} (${r.toolchain}, ${process.platform})`, see: "VERIFY.md, step 3" };
  // the real-money market on mainnet: the same bytes as the build, read from mainnet itself
  let main = "";
  if (mainnet) {
    const mid = mainnet.dep.accounts.market;
    const mlive = offline ? null : (await mainnet.rpc.account(mid)).code_hash;
    const mwant = mlive || mainnet.dep.code.market.code_hash;
    if (mwant !== got.market) return { status: "FAIL", detail: `built market ${got.market}; mainnet ${mid} ${mlive ? "runs" : "is recorded as"} ${mwant} (${r.toolchain}, ${process.platform})`, see: "VERIFY.md, step 3" };
    main = `; the real-money market on mainnet, ${mid}, ${mlive ? "runs" : "is recorded as"} the same market build`;
  }
  return { status: "PASS", detail: `${r.toolchain} rebuilt market ${got.market} and swarm ${got.swarm}: identical to ${where}${main}; the agent wallet rebuilds to the committed contracts/swarm/res/agent.wasm`, see: X("address", dep.accounts.market) };
}

// ---------- 4. the deployment is live and its books close ----------
export async function checkBooks(dep, rpc) {
  const M = dep.accounts.market;
  const s = await rpc.view(M, "stats");
  const held = BigInt(await rpc.view(dep.accounts.usdc, "ft_balance_of", { account_id: M }));
  const b = (k) => BigInt(s[k]);
  const buckets = b("treasury_micro") + b("reserved_micro") + b("balances_micro") + b("collected_micro") + b("payouts_micro") + b("bonds_micro") + b("bounties_micro");
  // every claim, every page
  let collected = 0n, payouts = 0n, bounties = 0n, reserved = 0n, n = 0;
  for (let from = 0; ; from += 100) {
    const page = await rpc.view(M, "get_claims", { from, limit: 100 });
    for (const c of page) {
      n++;
      if (c.status !== "Settled") collected += BigInt(c.collected_micro);
      payouts += BigInt(c.payout_left_micro);
      bounties += BigInt(c.bounty_micro);
    }
    if (page.length < 100) break;
  }
  // every balance, read from the contract's own storage (the "b" map: borsh String -> u128)
  let balances = 0n, holders = 0, how;
  try {
    const st = await rpc.state(M, "b");
    for (const { key, value } of st.values || []) {
      const k = Buffer.from(key, "base64");
      if (k[0] !== 0x62 || k.length < 5 || k.readUInt32LE(1) !== k.length - 5) continue;
      const v = Buffer.from(value, "base64");
      if (v.length !== 16) continue;
      balances += v.readBigUInt64LE(0) + (v.readBigUInt64LE(8) << 64n);
      holders++;
    }
    how = `${holders} balances read from the contract's storage`;
  } catch (e) {
    // an RPC may refuse to list a large contract's state: then the listed seed traders only
    for (const t of dep.seed.traders) balances += BigInt(await rpc.view(M, "get_balance", { trader: t }));
    how = `the RPC would not list storage (${String(e.message).slice(0, 60)}), so the ${dep.seed.traders.length} seed traders' balances`;
  }
  const rows = [
    ["USDC the market holds = held_micro", held === b("held_micro")],
    ["held = treasury + reserved + balances + collected + payouts + bonds + bounties", held === buckets],
    ["sum of balances = balances_micro", balances === b("balances_micro")],
    ["sum of open claims' collected = collected_micro", collected === b("collected_micro")],
    ["sum of payouts left = payouts_micro", payouts === b("payouts_micro")],
    ["sum of bounties = bounties_micro", bounties === b("bounties_micro")],
  ];
  const failed = rows.filter((r) => !r[1]).map((r) => r[0]);
  const detail = `${M}: ${n} claims, ${s.paused ? "PAUSED" : "live"}; USDC held ${held} = treasury ${s.treasury_micro} + reserved ${s.reserved_micro} + balances ${s.balances_micro} + collected ${s.collected_micro} + payouts ${s.payouts_micro} + bonds ${s.bonds_micro} + bounties ${s.bounties_micro} (micro-USDC); ${how}`;
  if (failed.length || s.paused || n === 0) return { status: "FAIL", detail: `${failed.join("; ") || (s.paused ? "the market is paused" : "no claims")} · ${detail}`, see: X("address", M) };
  void reserved;
  return { status: "PASS", detail: `books close to the micro-USDC: ${detail}`, see: X("address", M) };
}

// ---------- 5. a recorded signed rewrite verifies offline, and is anchored ----------
const ED_SPKI = Buffer.from("302a300506032b6570032100", "hex");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const clean = (h) => String(h || "").toLowerCase().replace(/^0x/, "");

/** The sentence texts in a writer response (site/lib/core/verify.ts signedSentences). */
function signedSentences(bytes) {
  try {
    const content = JSON.parse(bytes.toString("utf8"))?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const s = content.replace(/```(?:json)?/gi, "");
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    const arr = JSON.parse(s.slice(a, b + 1)).sentences;
    return Array.isArray(arr) ? arr.map((x) => String(x?.text || "").trim().replace(/\s+/g, " ")) : null;
  } catch { return null; }
}

export async function checkRewrite(repo, dep, rpc, { offline }) {
  const ev = JSON.parse(fs.readFileSync(path.join(repo, "tools/judge/evidence/rewrite.json"), "utf8"));
  const rec = ev.record, p = rec.provenance;
  const steps = [];
  const step = (name, ok) => steps.push([name, ok]);
  const req = Buffer.from(p.request_b64 || "", "base64"), resp = Buffer.from(p.response_b64 || "", "base64");
  step("the exact request and response bytes are recorded", req.length > 0 && resp.length > 0);
  const rh = sha256(req), sh = sha256(resp);
  step("sha256(request) matches", rh === clean(p.request_hash));
  step("sha256(response) matches", sh === clean(p.response_hash));
  const text = `${p.model}:${rh}:${sh}`;
  step("the signature covers model:sha256(request):sha256(response)", p.signed_text === text);
  let sigOk = false;
  try { sigOk = verify(null, Buffer.from(text), createPublicKey({ key: Buffer.concat([ED_SPKI, Buffer.from(clean(p.signing_address), "hex")]), format: "der", type: "spki" }), Buffer.from(clean(p.signature), "hex")); } catch { sigOk = false; }
  step("ed25519 verifies", sigOk);
  const words = signedSentences(resp), shown = (rec.sentences || []).map((s) => s.text);
  step("the words on the page are the words signed", !!words && words.length === shown.length && words.every((w, i) => w === shown[i]));
  // the registered key: on testnet, or as recorded when offline
  let registered = null, anchored = null;
  if (offline) registered = dep.keys.writer_public_hex;
  else {
    registered = (await rpc.view(dep.accounts.market, "get_model", { model: p.model }))?.signing_address_hex ?? null;
    const tx = await rpc.tx(p.anchor.tx_hash, p.anchor.sender_id);
    const hit = marketEvents(tx, dep.accounts.market).find((d) => d.event === "rewrite" && clean(d.request_hash) === rh && clean(d.response_hash) === sh && clean(d.signature) === clean(p.signature) && d.model === p.model);
    anchored = !!hit;
  }
  step(`the key is the one registered for ${p.model} on the market${offline ? " (as recorded; chain not read)" : ""}`, clean(registered) === clean(p.signing_address));
  if (!offline) step("the market logged anchor_rewrite with these hashes and this signature", anchored);
  const failed = steps.filter((s) => !s[1]).map((s) => s[0]);
  const label = ev.writer_key === "test" ? "TEST writer key (services/ai's offline NEAR AI stand-in; no NEAR AI key exists yet), not NEAR AI Cloud" : "NEAR AI Cloud's TEE key";
  if (failed.length) return { status: "FAIL", detail: `${failed.join("; ")} · rewrite ${rec.id} signed by the ${label}`, see: "tools/judge/evidence/rewrite.json" };
  return {
    status: "PASS",
    detail: `rewrite ${rec.id} (${req.length} request bytes, ${resp.length} response bytes): both sha256s, the signed text and ed25519 verify offline${offline ? "; anchor not read (--offline)" : `; anchor_rewrite event on testnet in ${p.anchor.tx_hash}`}. Signed by the ${label}`,
    see: offline ? "tools/judge/evidence/rewrite.json" : X("txns", p.anchor.tx_hash),
  };
}

export { reproBuild };
