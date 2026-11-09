// Checks 3, 4 and 5: the contracts on testnet (and the real-money market on mainnet) are the
// source in this repo, their books close, and a recorded signed rewrite verifies from its own
// bytes and is anchored on-chain.
import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { booksAt } from "../lib/books.mjs";
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
  // every read at one final block, so a trade landing mid-check can't split the books
  const r = rpc.pinned(await rpc.finalHeight());
  const k = await booksAt(r.view, M, dep.accounts.usdc, { state: (prefix) => r.state(M, prefix), traders: dep.seed?.traders });
  const detail = `${M} at block ${r.blockId}: ${k.claims} claims, ${k.paused ? "PAUSED" : "live"}; ${k.equation}; ${k.how}`;
  if (!k.ok) return { status: "FAIL", detail: `${k.failed.join("; ") || (k.paused ? "the market is paused" : "no claims")} · ${detail}`, see: X("address", M) };
  return { status: "PASS", detail: `books close to the micro-USDC: ${detail}`, see: X("address", M) };
}

// ---------- 5. a recorded signed rewrite verifies offline, and is anchored ----------
export const ED_SPKI = Buffer.from("302a300506032b6570032100", "hex");
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

/**
 * A recorded rewrite: its bytes, hashes and ed25519 signature offline; online, the key the market
 * holds for the writer and the anchor_rewrite event. `evidence` is the record's path in the repo,
 * `explorer` the chain's explorer link maker; `blockId` pins the key read.
 */
export async function checkRewrite(repo, dep, rpc, { offline, evidence = "tools/judge/evidence/rewrite.json", explorer = X, blockId = null }) {
  const ev = JSON.parse(fs.readFileSync(path.join(repo, evidence), "utf8"));
  const rec = ev.record, p = rec.provenance;
  const net = dep.network || "testnet";
  const anchor = p.anchor?.tx_hash ? p.anchor : rec.anchor?.tx_hash ? rec.anchor : {};
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
  step(`the record is from ${dep.accounts.market}`, !ev.market || ev.market === dep.accounts.market);
  if (offline) registered = dep.keys.writer_public_hex;
  else {
    registered = (await rpc.view(dep.accounts.market, "get_model", { model: p.model }, { blockId }))?.signing_address_hex ?? null;
    const tx = await rpc.tx(anchor.tx_hash, anchor.sender_id || dep.accounts.market);
    const hit = marketEvents(tx, dep.accounts.market).find((d) => d.event === "rewrite" && clean(d.request_hash) === rh && clean(d.response_hash) === sh && clean(d.signature) === clean(p.signature) && d.model === p.model);
    anchored = !!hit;
  }
  step(`the key is the one registered for ${p.model} on the market${offline ? " (as recorded; chain not read)" : ""}`, clean(registered) === clean(p.signing_address));
  if (!offline) step("the market logged anchor_rewrite with these hashes and this signature", anchored);
  const failed = steps.filter((s) => !s[1]).map((s) => s[0]);
  const label = ev.writer_key === "test" ? "TEST writer key (services/ai's offline NEAR AI stand-in; no NEAR AI key exists yet), not NEAR AI Cloud" : "NEAR AI Cloud's TEE key";
  if (failed.length) return { status: "FAIL", detail: `${failed.join("; ")} · rewrite ${rec.id} signed by the ${label}`, see: evidence };
  return {
    status: "PASS",
    detail: `rewrite ${rec.id} (${req.length} request bytes, ${resp.length} response bytes): both sha256s, the signed text and ed25519 verify offline${offline ? "; anchor not read (--offline)" : `; anchor_rewrite event on ${net} in ${anchor.tx_hash}`}. Signed by the ${label}`,
    see: offline ? evidence : explorer("txns", anchor.tx_hash),
    anchor: anchor.tx_hash || null,
  };
}

export { reproBuild };
