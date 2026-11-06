// One-off: seeds the judge's testnet deployment so a reader sees something real, then writes
// deployments/testnet.json and tools/judge/evidence/rewrite.json.
//
//   node tools/judge/seed.mjs
//
// What it does, all on testnet, with test USDC from the deployment's own faucet:
//   - limits: $1 lane credit, $20 lane budget, $1 challenge bond; the treasury gets $80;
//   - opens the `data` sentences of one curated page (corpus/pages/tether.json, Wikipedia
//     revision pinned in the corpus) with open_and_buy and receipts signed by the TEST planner
//     key, at 50% each: no model planner has run on testnet, so no opening estimate is claimed;
//   - places a few trades from three seed accounts, guided by the corpus verdicts (NO on the
//     lines the corpus found stale, YES on lines it found current), plus one no-wallet $1 lane bet;
//   - records one rewrite produced by services/ai's writer against its offline NEAR AI stand-in
//     (a throwaway TEST writer key, not NEAR AI Cloud), registers that key for the writer model on
//     this market, and anchors the rewrite on-chain with anchor_rewrite.
// Keys stay in the git-ignored .apex-test/. Nothing secret is printed.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { createHash, createPrivateKey, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO, codeHash } from "./lib/repro.mjs";

const TGAS = 1_000_000_000_000n;
const NEAR = 10n ** 24n;
const RPC = "https://test.rpc.fastnear.com";
const provider = new JsonRpcProvider({ url: RPC });
const STATE = path.join(REPO, ".apex-test/judge-testnet.json");
const SEEDS = path.join(REPO, ".apex-test/judge-seed-accounts.json");
const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
const planner = JSON.parse(fs.readFileSync(path.join(REPO, ".apex-test/judge-planner.json"), "utf8"));
const spike = JSON.parse(fs.readFileSync(path.join(REPO, ".apex/spikes/s3-lane/testnet-accounts.json"), "utf8")).lane;
if (!st.root.endsWith(".testnet")) throw new Error("testnet only");
const kp = KeyPair.fromString(st.key);
const ROOT = st.root, M = `market.${ROOT}`, T = `tusdc.${ROOT}`, L = `lane.${ROOT}`, S = `swarm.${ROOT}`;
const root = new Account(ROOT, provider, new KeyPairSigner(kp));
const funder = new Account(spike.id, provider, new KeyPairSigner(KeyPair.fromString(spike.sk)));
const sha = (x) => createHash("sha256").update(x).digest("hex");
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } });
const txs = [];
async function call(acct, contractId, methodName, args, { deposit = 0n, tgas = 40n, tag = methodName } = {}) {
  const tx = await acct.callFunctionRaw({ contractId, methodName, args, gas: tgas * TGAS, deposit, waitUntil: "FINAL" });
  const fail = [tx.status, ...tx.receipts_outcome.map((r) => r.outcome.status)].find((s) => s?.Failure);
  if (fail) throw new Error(`${methodName} failed: ${JSON.stringify(fail).slice(0, 300)}`);
  const hash = tx.transaction.hash;
  const block = await provider.viewBlock({ blockId: tx.transaction_outcome.block_hash });
  txs.push({ tag, method: methodName, signer: acct.accountId, tx: hash, block: block.header.height });
  const v = tx.status?.SuccessValue ? Buffer.from(tx.status.SuccessValue, "base64").toString("utf8") : "";
  try { return { value: JSON.parse(v), hash }; } catch { return { value: v, hash }; }
}
const plannerKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(planner.seed_hex, "hex")]), format: "der", type: "pkcs8" });
const receipt = (page, text, kind, p0, b) => sign(null, Buffer.from(`open:${page}:${sha(Buffer.from(text, "utf8"))}:${kind}:${p0}:${b}`), plannerKey).toString("hex");

// ---------- NEAR for storage and seed accounts ----------
const avail = async (id) => { const a = await provider.viewAccount({ accountId: id, blockQuery: { finality: "final" } }); return Number(BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n) / 1e24; };
if ((await avail(spike.id)) < 6 + 2.5) throw new Error("the funder can't spare 2.5 NEAR and keep 6");
if ((await avail(ROOT)) < 1.5) await funder.transfer({ receiverId: ROOT, amount: 2n * NEAR });
if ((await avail(M)) < 0.5) await root.transfer({ receiverId: M, amount: 6n * NEAR / 10n });

// ---------- seed accounts ----------
let seeds = fs.existsSync(SEEDS) ? JSON.parse(fs.readFileSync(SEEDS, "utf8")) : {};
const traders = {};
for (const name of ["seed-a", "seed-b", "seed-c"]) {
  const id = `${name}.${ROOT}`;
  if (!seeds[name]) {
    const k = KeyPair.fromRandom("ed25519");
    seeds[name] = { id, sk: k.toString() };
    fs.writeFileSync(SEEDS, JSON.stringify(seeds, null, 1));
    await root.createSubAccount({ accountOrPrefix: name, publicKey: k.getPublicKey(), nearToTransfer: NEAR / 10n });
  }
  traders[name] = new Account(id, provider, new KeyPairSigner(KeyPair.fromString(seeds[name].sk)));
}

// ---------- limits, planner key, treasury ----------
const stats0 = await view(M, "stats");
if (stats0.lane_budget_micro === "0") await call(root, M, "set_limits", { reserve_cap_micro: "2000000000", lane_budget_micro: "20000000", lane_credit_micro: "1000000", challenge_bond_micro: "1000000" });
if (BigInt(stats0.treasury_micro) < 50_000_000n && BigInt(stats0.reserved_micro) === 0n) {
  for (let i = 0; i < 8; i++) await call(root, T, "faucet", {}, { tag: "faucet (treasury)" });
  await call(root, T, "ft_transfer_call", { receiver_id: M, amount: "80000000", msg: "{\"treasury\":true}" }, { deposit: 1n, tgas: 60n, tag: "fund the treasury" });
}
for (const a of Object.values(traders)) {
  if (BigInt(await view(M, "get_balance", { trader: a.accountId })) > 0n) continue;
  for (let i = 0; i < 2; i++) await call(a, T, "faucet", {});
  await call(a, T, "ft_transfer_call", { receiver_id: M, amount: "20000000", msg: "" }, { deposit: 1n, tgas: 60n, tag: "deposit" });
}

// ---------- open one curated page ----------
const PAGE = "tether";
const corpus = JSON.parse(fs.readFileSync(path.join(REPO, `corpus/pages/${PAGE}.json`), "utf8"));
// the corpus's `data` sentences, minus any that name a person: pages are about protocols, never people
const PEOPLE = /\b(Ardoino|Devasini|Pierce|Collins|Willett|Potter|Hoegner|Lutnick|Polosukhin|Skidanov)\b/;
const lines = corpus.sentences.filter((s) => s.class === "data" && !PEOPLE.test(s.text) && Buffer.byteLength(s.text) <= 600);
const P0 = 500000, B = "3000000", KIND = "data";
const existing = await view(M, "get_claims", { from: 0, limit: 100 });
const claimOf = new Map(existing.filter((c) => c.page === PAGE).map((c) => [c.text, c.id]));
const opener = traders["seed-a"];
for (const s of lines) {
  if (claimOf.has(s.text)) continue;
  const r = await call(opener, M, "open_and_buy", { text: s.text, page: PAGE, kind: KIND, p0_ppm: P0, b_micro: B, planner_sig_hex: receipt(PAGE, s.text, KIND, P0, B), side: "yes", amount_micro: "100000" }, { tag: `open ${s.id}` });
  claimOf.set(s.text, r.value.claim_id);
}

// ---------- a few trades, guided by the corpus verdicts ----------
const done = new Set(txs.filter((t) => t.tag.startsWith("trade")).map((t) => t.tag));
const trades = [];
const byVerdict = (v) => lines.filter((s) => s.verdict === v);
const already = (await view(M, "stats")).claims > 0 && fs.existsSync(path.join(REPO, "deployments/testnet.json")) && JSON.parse(fs.readFileSync(path.join(REPO, "deployments/testnet.json"), "utf8")).seed?.trades?.length;
if (!already) {
  for (const s of byVerdict("stale")) trades.push([traders["seed-b"], s, "no", "2000000", `trade: NO on a line the corpus found stale (${s.id})`]);
  for (const s of byVerdict("current").slice(0, 3)) trades.push([traders["seed-c"], s, "yes", "1000000", `trade: YES on a line the corpus found current (${s.id})`]);
  for (const [who, s, side, amt, tag] of trades) {
    if (done.has(tag)) continue;
    await call(who, M, "buy", { claim_id: claimOf.get(s.text), side, amount_micro: amt, min_shares_micro: "0" }, { tag });
  }
}

// ---------- one no-wallet $1 bet on the lane, the way a judge's browser makes it ----------
const laneSt = path.join(REPO, ".apex-test/judge-lane-key.json");
let laneTrader = null;
if (!fs.existsSync(laneSt)) {
  const k = KeyPair.fromRandom("ed25519");
  fs.writeFileSync(laneSt, JSON.stringify({ sk: k.toString() }));
  const laneAdmin = new Account(L, provider, new KeyPairSigner(kp));
  await laneAdmin.addFunctionCallAccessKey({ publicKey: k.getPublicKey(), contractId: M, methodNames: ["buy", "sell", "open_and_buy", "redeem"], allowance: NEAR / 20n });
  const visitor = new Account(L, provider, new KeyPairSigner(k));
  const stale = byVerdict("stale")[0];
  await call(visitor, M, "buy", { claim_id: claimOf.get(stale.text), side: "no", amount_micro: "1000000", min_shares_micro: "0" }, { tgas: 30n, tag: `trade: a no-wallet $1 lane bet, NO (${stale.id})` });
}
laneTrader = `lane:${KeyPair.fromString(JSON.parse(fs.readFileSync(laneSt, "utf8")).sk).getPublicKey().toString()}`;

// ---------- a recorded signed rewrite, anchored on-chain ----------
const EVIDENCE = path.join(REPO, "tools/judge/evidence/rewrite.json");
if (!fs.existsSync(EVIDENCE)) {
  const { NearAI, Attestor, verifyProvenance } = await import("../../services/ai/src/nearai.js");
  const { Writer } = await import("../../services/ai/src/writer.js");
  const { EventHub } = await import("../../services/api/src/events.mjs");
  const { RewriteStore } = await import("../../services/api/src/rewrites.mjs");
  const { startMockNearAI, MOCK_MODELS } = await import("../../services/ai/test/mock-nearai.mjs");
  const MODEL = MOCK_MODELS[2];
  const mock = await startMockNearAI();
  try {
    const all = (await view(M, "get_claims", { from: 0, limit: 100 })).map((c) => ({ ...c, id: c.claim_id ?? c.id }));
    const pageClaims = all.filter((c) => c.page === PAGE);
    const stale = byVerdict("stale")[0];
    const target = pageClaims.find((c) => c.text === stale.text);
    // paragraphs follow the corpus's sections
    const sectionOf = new Map(corpus.sentences.map((s) => [s.text, s.section]));
    const sections = [...new Set(pageClaims.map((c) => sectionOf.get(c.text)))];
    const pagesDoc = { pages: { [PAGE]: { paragraphs: sections.map((sec) => pageClaims.filter((c) => sectionOf.get(c.text) === sec).map((c) => c.id)) } } };
    await call(root, M, "register_model", { model: MODEL, signing_address_hex: mock.signerHex(MODEL), extras_json: "" }, { tag: "register the TEST writer key" });
    const client = new NearAI({ apiKey: mock.apiKey, baseUrl: mock.url });
    const attestor = new Attestor({ client, quoteVerifier: mock.quoteVerifier, gpuVerifier: mock.gpuVerifier });
    const anchor = async (_intent, args) => {
      const r = await call(root, M, "anchor_rewrite", args, { tag: "anchor_rewrite" });
      return { ok: true, txHash: r.hash };
    };
    const writer = new Writer({
      client, attestor, model: MODEL, store: new RewriteStore(), hub: new EventHub(), signatureDeadlineMs: 5000, anchor, pagesDoc,
      claims: { one: async (id) => pageClaims.find((c) => c.id === id) || null, byPage: async () => pageClaims },
    });
    const laneTx = txs.find((t) => t.tag.startsWith("trade: a no-wallet"));
    let rec = await writer.onTrade({ uid: "seed", event: "trade", data: { claim_id: target.id, trader: laneTrader, side: "no", price_yes_ppm: target.price_yes_ppm }, txHash: laneTx?.tx ?? null });
    if (rec?.status !== "signed") throw new Error(`expected a signed rewrite, got ${rec?.status}: ${rec?.provenance?.reason}`);
    const check = verifyProvenance(rec.provenance, { signing_address: mock.signerHex(MODEL) });
    if (!check.ok) throw new Error(`services/ai's own check failed: ${check.reasons.join("; ")}`);
    // a signed rewrite is anchored by the writer itself, in the background: wait for it
    for (let i = 0; i < 120 && !(writer.store.get(rec.id)?.anchor?.status === "anchored"); i++) await new Promise((r) => setTimeout(r, 500));
    rec = writer.store.get(rec.id) || rec;
    if (rec.anchor?.status !== "anchored") throw new Error(`the writer did not anchor the rewrite: ${JSON.stringify(rec.anchor)}`);
    const anchorTx = txs.find((t) => t.tag === "anchor_rewrite");
    rec.provenance = { ...rec.provenance, anchor: { tx_hash: anchorTx.tx, sender_id: ROOT, block: anchorTx.block } };
    fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
    fs.writeFileSync(EVIDENCE, JSON.stringify({
      note: "One rewrite of the seeded page, produced by services/ai's writer against its offline NEAR AI stand-in (services/ai/test/mock-nearai.mjs). It is signed by a throwaway TEST writer key, not by NEAR AI Cloud: no NEARAI_API_KEY existed when it was recorded. The key's public half is registered for the model on the testnet market, and the rewrite is anchored there with anchor_rewrite.",
      writer_key: "test", model: MODEL, signer: mock.signerHex(MODEL), market: M, record: rec,
    }, null, 1) + "\n");
  } finally { await mock.close?.(); }
}

// ---------- deployments/testnet.json ----------
const OUT = path.join(REPO, "deployments/testnet.json");
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
const allTx = [...(prev?.seed?.transactions || []), ...txs.filter((t) => !t.tag.startsWith("faucet"))];
const stats = await view(M, "stats");
const head = await provider.viewBlock({ finality: "final" });
const acct = async (id) => (await provider.viewAccount({ accountId: id, blockQuery: { finality: "final" } }));
const hashes = {};
for (const [k, id] of Object.entries({ market: M, swarm: S, tusdc: T })) hashes[k] = (await acct(id)).code_hash;
const wasmDir = path.join(REPO, "target/judge-repro/wasm32-unknown-unknown/release");
const shaOf = (f) => (fs.existsSync(path.join(wasmDir, f)) ? sha(fs.readFileSync(path.join(wasmDir, f))) : null);
const claims = (await view(M, "get_claims", { from: 0, limit: 100 })).filter((c) => c.page === PAGE);
const corpusId = new Map(lines.map((s) => [s.text, s]));
const X = (kind, v) => `https://testnet.nearblocks.io/${kind}/${v}`;
const out = {
  note: "The persistent testnet deployment the judge checks (npm run judge). Public values only: no key is here. Built reproducibly by tools/judge/lib/repro.mjs and deployed by scripts/deploy.mjs testnet through tools/judge/deploy-testnet.mjs; seeded by tools/judge/seed.mjs.",
  network: "testnet",
  rpc: RPC,
  root: ROOT,
  accounts: { market: M, swarm: S, lane: L, usdc: T },
  usdc: { account: T, kind: "test USDC (contracts/tusdc): 6 decimals, anyone can call faucet() for 10 tUSDC", mainnet_usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" },
  code: {
    market: { code_hash: hashes.market, sha256: shaOf("pricedin_market.wasm"), source: "contracts/market", build: "node tools/judge/repro.mjs" },
    swarm: { code_hash: hashes.swarm, sha256: shaOf("pricedin_swarm.wasm"), source: "contracts/swarm (embeds contracts/swarm/res/agent.wasm)", build: "node tools/judge/repro.mjs" },
    agent_wallet: { code_hash: codeHash(fs.readFileSync(path.join(REPO, "contracts/swarm/res/agent.wasm"))), source: "contracts/agent-wallet" },
    tusdc: { code_hash: hashes.tusdc, source: "contracts/tusdc", build: "npm run build:contracts (not part of the reproducibility claim)" },
    toolchain: "rustc 1.99.1, wasm32-unknown-unknown, RUSTFLAGS --cfg near -C target-cpu=mvp -C link-arg=-s plus path remaps",
  },
  keys: {
    planner_public_hex: planner.public_hex,
    planner: "TEST planner key, made for this deployment; its private half is not in git",
    writer_model: "z-ai/glm-5.3-flash",
    writer_public_hex: (await view(M, "get_model", { model: "z-ai/glm-5.3-flash" }))?.signing_address_hex ?? null,
    writer: "TEST writer key of services/ai's offline NEAR AI stand-in; NOT a NEAR AI Cloud key",
  },
  seed: {
    page: PAGE,
    source: `corpus/pages/${PAGE}.json, ${corpus.url}`,
    opening: "every line opened at 50% with b = $3: no model planner ran on testnet, so no opening estimate is claimed",
    claims: claims.map((c) => ({ claim_id: c.claim_id ?? c.id, corpus_id: corpusId.get(c.text)?.id ?? null, corpus_verdict: corpusId.get(c.text)?.verdict ?? null, price_yes_ppm: c.price_yes_ppm })),
    traders: [...Object.values(traders).map((a) => a.accountId), laneTrader],
    trades: allTx.filter((t) => t.tag.startsWith("trade")).map((t) => ({ what: t.tag.replace(/^trade: /, ""), tx: t.tx, block: t.block, link: X("txns", t.tx) })),
    transactions: allTx,
  },
  rewrite: { evidence: "tools/judge/evidence/rewrite.json", anchor_tx: allTx.find((t) => t.tag === "anchor_rewrite")?.tx ?? null },
  stats_at_record: stats,
  recorded_at_block: head.header.height,
  recorded_at: new Date(Number(BigInt(head.header.timestamp_nanosec) / 1_000_000n)).toISOString(),
  explorer: {
    market: X("address", M), swarm: X("address", S), lane: X("address", L), usdc: X("address", T), root: X("address", ROOT),
  },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote deployments/testnet.json: ${claims.length} claims on "${PAGE}", ${out.seed.trades.length} trades, rewrite anchored in ${out.rewrite.anchor_tx}`);
console.log(`funder ${spike.id}: ${(await avail(spike.id)).toFixed(3)} NEAR available`);
setTimeout(() => process.exit(0), 50).unref();
