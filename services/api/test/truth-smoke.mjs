// npm run truth:smoke: the truth API live, against the persistent testnet deployment
// (deployments/testnet.json) and its seeded Tether page.
//
// 1. Starts the API as its own process on that market, with x402 on: $0.01 of test USDC to a
//    payee account, settled by our own facilitator (an in-process relayer key).
// 2. Asks a question about the Tether page on the free tier; checks the matched claim, its
//    price against the chain, and the provenance (the anchored rewrite's signature).
// 3. Asks with no match: the plain answer and the paste flow's offer.
// 4. Runs pricedin-mcp over stdio against that API and keeps the session transcript.
// 5. Past the free tier: the 402 challenge, then one payment by a real x402 client
//    (@fastnear/x402's createNearPaymentFetch with the payer's own key): the settled
//    receipt, checked on chain (the payee's balance rose by exactly the price).
// 6. Replays the same payment: refused, and nothing more moves.
//
// This run is testnet only: it refuses NEAR_NETWORK=mainnet. Offline, it prints SKIP and exits 0.
// The hosted API on mainnet has its own run: --network mainnet --plan reads and spends nothing,
// and --network mainnet with CONFIRM_MAINNET=yes pays $0.01 (truth-smoke-mainnet.mjs).
// Accounts it needs (payee, relayer, payer) are made once from the funder (FUNDER_ID /
// FUNDER_KEY, or the local spike account) and kept, keys and all, in the git-ignored
// .apex-test/truth-testnet.json. Without a funder or that file the payment part SKIPs.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Rpc } from "../src/rpc.mjs";
import { unb64json } from "../src/x402.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVER = path.join(ROOT, "services/api/src/server.mjs");
const MCP = path.join(ROOT, "tools/mcp/bin/pricedin-mcp.mjs");
const EVIDENCE = path.join(ROOT, "tools/judge/evidence/rewrite.json");
const STATE = path.join(ROOT, ".apex-test/truth-testnet.json");
const TRANSCRIPT = path.join(ROOT, ".apex-test/truth-mcp-transcript.txt");
const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const QUESTION = "Does Tether issue USDT on NEAR?";

const netArg = process.argv.indexOf("--network");
if (netArg > 0 && process.argv[netArg + 1] === "mainnet") {
  const plan = process.argv.includes("--plan");
  if (!plan && process.env.CONFIRM_MAINNET !== "yes") {
    console.error("Refusing to spend on mainnet: set CONFIRM_MAINNET=yes to mean it, or use --plan.");
    process.exit(1);
  }
  const { mainnetSmoke } = await import("./truth-smoke-mainnet.mjs");
  process.exit(await mainnetSmoke({ plan }));
}
if ((process.env.NEAR_NETWORK || "testnet") !== "testnet") {
  console.error("truth:smoke runs on testnet only; unset NEAR_NETWORK or set it to testnet.");
  process.exit(1);
}
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
if (dep.network !== "testnet") { console.error("deployments/testnet.json is not a testnet deployment"); process.exit(1); }
const RPC_URLS = process.env.RPC_URLS ? process.env.RPC_URLS.split(",").map((u) => u.trim()).filter(Boolean) : [dep.rpc, "https://rpc.testnet.near.org"];
const MARKET = dep.accounts.market, USDC = dep.accounts.usdc;
const evidence = JSON.parse(fs.readFileSync(EVIDENCE, "utf8"));

const rpc = new Rpc(RPC_URLS, { timeoutMs: 10000 });
try { await rpc.call("status", [], { timeoutMs: 6000 }); }
catch (e) { console.log(`SKIP truth:smoke: offline: testnet RPC unreachable (${e.message})`); process.exit(0); }
const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
const view = (contractId, method, args = {}) => rpc.viewFunction(contractId, method, args, { timeoutMs: 8000 });

let failures = 0, skips = 0;
const lines = [];
const check = (name, ok, detail = "") => { const l = `${ok ? "PASS" : "FAIL"} ${name}${detail ? " · " + detail : ""}`; lines.push(l); console.log(l); if (!ok) failures++; };
const skip = (name, why) => { const l = `SKIP ${name} · ${why}`; lines.push(l); console.log(l); skips++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- accounts: payee, relayer, payer (made once, kept locally) ----------
function funderAccount() {
  if (process.env.FUNDER_ID && process.env.FUNDER_KEY) return new Account(process.env.FUNDER_ID, provider, new KeyPairSigner(KeyPair.fromString(process.env.FUNDER_KEY)));
  const f = path.join(ROOT, ".apex/spikes/s3-lane/testnet-accounts.json");
  if (fs.existsSync(f)) { const l = JSON.parse(fs.readFileSync(f, "utf8")).lane; return new Account(l.id, provider, new KeyPairSigner(KeyPair.fromString(l.sk))); }
  return null;
}
const acct = (a) => new Account(a.id, provider, new KeyPairSigner(KeyPair.fromString(a.sk)));
const nearOf = async (id) => Number(BigInt((await provider.viewAccount({ accountId: id })).amount) / 10n ** 21n) / 1000;

async function accounts() {
  let st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
  const funder = funderAccount();
  if (funder?.accountId.endsWith(".near")) throw new Error("the funder is a mainnet account; truth:smoke runs on testnet only");
  if (!st) {
    if (!funder) return null;
    const avail = Number(BigInt((await funder.getState()).balance.available) / 10n ** 21n) / 1000;
    if (avail < 2) throw new Error(`funder ${funder.accountId} has ${avail} NEAR; truth:smoke needs 2 to make its accounts once`);
    st = { note: "truth:smoke's testnet accounts. TEST keys: testnet only, never in git.", market: MARKET };
    const stamp = Date.now().toString(36);
    for (const [role, near] of [["payee", "0.1"], ["relayer", "0.6"], ["payer", "0.2"]]) {
      const kp = KeyPair.fromRandom("ed25519");
      const name = `truth${role}-${stamp}`;
      await funder.createSubAccount({ accountOrPrefix: name, publicKey: kp.getPublicKey(), nearToTransfer: BigInt(Math.round(Number(near) * 100)) * NEAR / 100n });
      st[role] = { id: `${name}.${funder.accountId}`, sk: kp.toString() };
      fs.mkdirSync(path.dirname(STATE), { recursive: true });
      fs.writeFileSync(STATE, JSON.stringify(st, null, 1));
      console.log(`made ${role} ${st[role].id} with ${near} NEAR`);
    }
  }
  // the relayer pays gas for every settlement: keep it topped up
  if (funder && (await nearOf(st.relayer.id)) < 0.2) { await funder.transfer({ receiverId: st.relayer.id, amount: NEAR / 2n }); console.log("topped up the relayer with 0.5 NEAR"); }
  // the payee must be registered on the token (NEP-145) to receive
  const reg = await view(USDC, "storage_balance_of", { account_id: st.payee.id });
  if (!reg) await acct(st.relayer).callFunction({ contractId: USDC, methodName: "register", args: { account_id: st.payee.id }, gas: 30n * TGAS });
  // the payer holds test USDC from the faucet
  if (BigInt(await view(USDC, "ft_balance_of", { account_id: st.payer.id })) < 100_000n) await acct(st.payer).callFunction({ contractId: USDC, methodName: "faucet", args: {}, gas: 30n * TGAS });
  return st;
}

// ---------- the API ----------
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const children = [];
async function startApi(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NEAR_NETWORK: "testnet", HOST: "127.0.0.1", PORT: String(port), ...env }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  const out = [];
  child.stdout.on("data", (d) => out.push(String(d)));
  child.stderr.on("data", (d) => out.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/v1`); if (r.ok) return { base, out }; } catch { /* starting */ }
    await sleep(250);
  }
  throw new Error(`API did not start: ${out.join("").slice(-800)}`);
}
async function get(base, p, headers = {}, fetchImpl = fetch) {
  const r = await fetchImpl(base + p, { headers });
  return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
}

/** pricedin-mcp over stdio: initialize, list, ask. Returns the transcript lines. */
async function mcpSession(apiBase, question) {
  const child = spawn(process.execPath, [MCP], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PRICEDIN_API_URL: apiBase, NEAR_NETWORK: "testnet" }, stdio: ["pipe", "pipe", "pipe"] });
  children.push(child);
  const transcript = [`$ PRICEDIN_API_URL=${apiBase} node tools/mcp/bin/pricedin-mcp.mjs   (stdio)`];
  let buf = "";
  const waiting = new Map();
  child.stderr.on("data", (d) => transcript.push(`[stderr] ${String(d).trim()}`));
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      transcript.push(`<- ${line}`);
      const m = JSON.parse(line); waiting.get(m.id)?.(m);
    }
  });
  let id = 0;
  const send = (o) => { const line = JSON.stringify(o); transcript.push(`-> ${line}`); child.stdin.write(line + "\n"); };
  const request = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id; const t = setTimeout(() => reject(new Error(`MCP: no answer to ${method}`)), 30000);
    waiting.set(mid, (m) => { clearTimeout(t); resolve(m); });
    send({ jsonrpc: "2.0", id: mid, method, params });
  });
  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "truth-smoke", version: "1" } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const list = await request("tools/list", {});
  const ask = await request("tools/call", { name: "ask", arguments: { question } });
  child.stdin.end();
  return { init, list, ask, transcript };
}

process.on("unhandledRejection", (e) => { console.log("FATAL", e?.message || String(e)); for (const c of children) c.kill(); process.exit(2); });

const t0 = Date.now();
try {
  console.log(`testnet market ${MARKET}, test USDC ${USDC}`);
  let st = null;
  try { st = await accounts(); } catch (e) { console.log(`accounts: ${e.message}`); }
  const env = {
    RPC_URLS: RPC_URLS.join(","), MARKET_CONTRACT_ID: MARKET, USDC_CONTRACT_ID: USDC,
    CREDENCE_FREE_PER_IP_PER_DAY: "3", REWRITE_EVIDENCE_FILES: EVIDENCE,
    ...(st ? { X402_PAY_TO: st.payee.id, X402_RELAYER_ACCOUNT_ID: st.relayer.id, X402_RELAYER_PRIVATE_KEY: st.relayer.sk } : {}),
  };
  const api = await startApi(env);
  const info = await get(api.base, "/v1");
  check("the API is up on the testnet deployment", info.json?.contract === MARKET && info.json?.network === "testnet", `${api.base} · market ${MARKET}${info.json?.credence?.payments ? ` · x402 ${info.json.credence.payments.network} $${info.json.credence.payments.usd} to ${info.json.credence.payments.payTo}` : ""}`);

  // ---------- 2. a question about the seeded page, free ----------
  const seed = dep.seed.claims.find((c) => c.corpus_id === "tether-0030");
  const a = await get(api.base, `/v1/credence?q=${encodeURIComponent(QUESTION)}`);
  const top = a.json?.claims?.[0];
  check(`"${QUESTION}" matches the seeded claim`, a.status === 200 && top?.claim_id === seed.claim_id, top ? `claim ${top.claim_id}: "${top.text.slice(0, 70)}…" (${top.match.kind}, score ${top.match.score})` : `status ${a.status} ${JSON.stringify(a.json)?.slice(0, 200)}`);
  const chain = await view(MARKET, "get_claim", { claim_id: seed.claim_id });
  check("its credence is the chain's price, with open interest and the cost to move", top && top.price.yes_ppm === chain.price_yes_ppm && top.open_interest_usd === Number(chain.open_interest_micro) / 1e6 && top.cost_to_move_10_points.up_usd === Number(chain.cost_up_10_micro) / 1e6,
    top ? `${top.summary} (chain: ${chain.price_yes_ppm} ppm, OI ${chain.open_interest_micro} micro)` : "");
  const w = top?.provenance?.last_rewrite;
  check("provenance: contract, claim id and the anchored rewrite's signature", top?.provenance?.contract === MARKET && w?.signature === evidence.record.provenance.signature && w?.anchor_tx === dep.rewrite.anchor_tx,
    w ? `${w.id} signed by ${w.model} (ed25519 ${w.signature.slice(0, 16)}…), anchored ${w.anchor_explorer}` : "no rewrite");
  check("resolution state and the rationales field are present", top?.resolution?.state === "open" && Array.isArray(top?.rationales), `${top?.resolution?.note} Rationales: ${top?.rationales?.length ?? 0}${top?.rationales_note ? ` (${top.rationales_note})` : ""}`);

  // ---------- 3. no match ----------
  const none = await get(api.base, `/v1/credence?q=${encodeURIComponent("Is the Moon made of green cheese?")}`);
  check("no match is said plainly, with the offer to open the claim", none.json?.matched === 0 && /No claim on Priced In matches that/.test(none.json?.answer) && none.json?.open?.result?.sentences?.length === 1, `${none.json?.answer} Open: ${none.json?.open?.result?.planner} planner, ${none.json?.open?.result?.sentences?.[0]?.status}`);

  // ---------- 4. MCP over stdio ----------
  const m = await mcpSession(api.base, QUESTION);
  fs.mkdirSync(path.dirname(TRANSCRIPT), { recursive: true });
  fs.writeFileSync(TRANSCRIPT, m.transcript.join("\n") + "\n");
  const mt = m.ask.result?.content?.[0]?.text || "";
  check("pricedin-mcp over stdio: ask answers about the seeded claim", m.init.result?.serverInfo?.name === "pricedin-mcp" && m.list.result?.tools?.length === 4 && m.ask.result?.isError === false && mt.includes(`Claim ${seed.claim_id} (page tether)`), `transcript in .apex-test/truth-mcp-transcript.txt; ${mt.split("\n").find((l) => l.startsWith("Credence:"))}`);

  // ---------- 5. past the free tier: 402, then one payment ----------
  const ch = await get(api.base, `/v1/credence?q=${encodeURIComponent(QUESTION)}`);
  if (!st) {
    check("past the free tier, with no facilitator: 429", ch.status === 429, ch.json?.error?.message);
    skip("x402 payment on testnet", "no funder and no .apex-test/truth-testnet.json: set FUNDER_ID and FUNDER_KEY (a funded testnet account) to run it");
  } else {
    const hdr = ch.headers.get("payment-required");
    const req = hdr ? unb64json(hdr) : null;
    const acc = req?.accepts?.[0];
    check("past the free tier: 402 with the x402 v2 challenge", ch.status === 402 && req?.x402Version === 2 && acc?.network === "near:testnet" && acc?.asset === USDC && acc?.amount === "10000" && acc?.payTo === st.payee.id, acc ? `${acc.scheme} ${acc.network}: ${acc.amount} micro-tUSDC of ${acc.asset} to ${acc.payTo}, ${acc.maxTimeoutSeconds} s` : `status ${ch.status}`);

    const { createNearPaymentFetch } = await import("@fastnear/x402");
    const { createLocalNearSigner } = await import("@fastnear/x402/node");
    const before = BigInt(await view(USDC, "ft_balance_of", { account_id: st.payee.id }));
    const payerBefore = BigInt(await view(USDC, "ft_balance_of", { account_id: st.payer.id }));
    let sentHeader = null;
    const recordingFetch = (input, init) => {
      const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (h.get("payment-signature")) sentHeader = h.get("payment-signature");
      return fetch(input, init);
    };
    const paidFetch = createNearPaymentFetch({ signer: createLocalNearSigner({ accountId: st.payer.id, secretKey: st.payer.sk, rpcUrls: { "near:testnet": RPC_URLS[0] } }), network: "near:testnet", fetch: recordingFetch });
    const tp = Date.now();
    const paid = await get(api.base, `/v1/credence?q=${encodeURIComponent(QUESTION)}`, {}, paidFetch);
    const payMs = Date.now() - tp;
    const resp = paid.headers.get("payment-response") ? unb64json(paid.headers.get("payment-response")) : null;
    const receipt = paid.json?.payment;
    check("one x402 payment by @fastnear/x402 with the payer's own key: answered, with PAYMENT-RESPONSE", paid.status === 200 && resp?.success === true && paid.json?.claims?.[0]?.claim_id === seed.claim_id && receipt?.settled === true,
      resp ? `settled in ${payMs} ms, payer ${resp.payer}, tx ${resp.transaction}` : `status ${paid.status} ${JSON.stringify(paid.json)?.slice(0, 300)}`);
    if (resp?.transaction) {
      const tx = await rpc.txStatus(resp.transaction, st.relayer.id, "FINAL", { timeoutMs: 20000 }).catch((e) => ({ error: e.message }));
      const logs = (tx.receipts_outcome || []).flatMap((r) => r.outcome.logs);
      const ev = logs.map((l) => { try { return l.startsWith("EVENT_JSON:") ? JSON.parse(l.slice(11)) : null; } catch { return null; } }).find((e) => e?.event === "ft_transfer");
      const d = ev?.data?.[0];
      check("the receipt is on chain: an ft_transfer of exactly $0.01 from the payer to the payee", d?.old_owner_id === st.payer.id && d?.new_owner_id === st.payee.id && d?.amount === "10000", `${receipt.explorer}`);
      let after = before;
      for (let i = 0; i < 10 && after === before; i++) { after = BigInt(await view(USDC, "ft_balance_of", { account_id: st.payee.id })); if (after === before) await sleep(800); }
      const payerAfter = BigInt(await view(USDC, "ft_balance_of", { account_id: st.payer.id }));
      check("balances moved by the price and nothing else", after - before === 10000n && payerBefore - payerAfter === 10000n, `payee +${after - before}, payer -${payerBefore - payerAfter} micro-tUSDC`);
      // ---------- 6. replay ----------
      const replay = await get(api.base, `/v1/credence?q=${encodeURIComponent(QUESTION)}`, { "payment-signature": sentHeader });
      await sleep(1500);
      const afterReplay = BigInt(await view(USDC, "ft_balance_of", { account_id: st.payee.id }));
      check("the same payment replayed is refused and moves nothing", !!sentHeader && replay.status === 402 && !replay.json?.claims && afterReplay === after && /nonce|duplicate/.test(replay.json?.error || ""), sentHeader ? `402: ${replay.json?.error}` : "the client's PAYMENT-SIGNATURE header was not captured");
      fs.writeFileSync(path.join(ROOT, ".apex-test/truth-receipt.json"), JSON.stringify({ at: new Date().toISOString(), challenge: req, settlement: resp, receipt, payee: st.payee.id, payer: st.payer.id, relayer: st.relayer.id }, null, 1));
    }
  }
  const h = await get(api.base, "/health");
  console.log(`credence stats: ${JSON.stringify(h.json?.checks?.credence?.stats)}`);
} finally {
  for (const c of children) { try { c.kill(); } catch { /* gone */ } }
}
console.log(`${lines.length - skips - failures}/${lines.length - skips} checks passed${skips ? `, ${skips} skipped` : ""} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
