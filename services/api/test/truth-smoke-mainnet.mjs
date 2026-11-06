// npm run truth:smoke -- --network mainnet: the paid truth API, live, on the hosted API.
//
//   node services/api/test/truth-smoke.mjs --network mainnet --plan
//       reads only: what the API offers, who would pay, what it would spend. No key is used.
//   CONFIRM_MAINNET=yes node services/api/test/truth-smoke.mjs --network mainnet
//       the real run: one $0.01 payment in real USDC. docs/API.md has what you should see.
//
// The payer is checker.isitpriced.near, whose full-access recovery key is already in the git-ignored
// .apex-test/mainnet/checker-key.json. Its market balance holds more than its bond needs, so nothing
// new is funded: if its wallet can't cover the price, the run registers it on USDC (0.00125 NEAR,
// once) and withdraws $0.05 from its own market balance. The $0.01 lands at the pay-to account.
// PAYER_ACCOUNT_ID and PAYER_PRIVATE_KEY name another payer; it can't be the relayer or the pay-to.
//
// The real run:
//   1. uses up this address's free calls: each one is counted exactly once, across instances
//   2. takes the 402 and checks it against GET /v1
//   3. pays with @fastnear/x402's createNearPaymentFetch and the payer's own key
//   4. checks the chain: the pay-to rose by the price, the payer fell by the price, nothing else
//   5. replays the same PAYMENT-SIGNATURE: 402 with the delegate's nonce spent, and nothing moves
//   6. reads the payment back from GET /v1 as truth_api
// The receipt goes to the git-ignored .apex-test/mainnet/truth-receipt.json. No key is printed.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Rpc } from "../src/rpc.mjs";
import { unb64json } from "../src/x402.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RECEIPT = path.join(ROOT, ".apex-test/mainnet/truth-receipt.json");
const RPC_URLS = (process.env.NEAR_RPC_MAINNET || "https://rpc.fastnear.com,https://near.drpc.org,https://free.rpc.fastnear.com").split(",");
const TGAS = 10n ** 12n;
const PATH = "/v1/credence?claim=0&open=0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usd = (micro) => `$${(Number(micro) / 1e6).toFixed(2)}`;

function payerOf(dep) {
  if (process.env.PAYER_ACCOUNT_ID) return { id: process.env.PAYER_ACCOUNT_ID, sk: process.env.PAYER_PRIVATE_KEY || null, from: "PAYER_ACCOUNT_ID" };
  const f = path.join(ROOT, ".apex-test/mainnet/checker-key.json");
  if (fs.existsSync(f)) { const k = JSON.parse(fs.readFileSync(f, "utf8")); return { id: k.accountId, sk: k.privateKey, from: ".apex-test/mainnet/checker-key.json" }; }
  return { id: dep.checker?.account ?? null, sk: null, from: "none: set PAYER_ACCOUNT_ID and PAYER_PRIVATE_KEY" };
}

/** @returns {Promise<number>} the exit code */
export async function mainnetSmoke({ plan = false, base = process.env.TRUTH_API_URL || "https://isitpriced.com" } = {}) {
  const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/mainnet.json"), "utf8"));
  if (dep.network !== "mainnet") { console.error("deployments/mainnet.json is not a mainnet deployment"); return 1; }
  const rpc = new Rpc(RPC_URLS, { timeoutMs: 10000 });
  const USDC = dep.accounts.usdc, MARKET = dep.accounts.market;
  const view = (id, method, args = {}) => rpc.viewFunction(id, method, args, { finality: "final", timeoutMs: 8000 });
  const held = async (id) => BigInt(await view(USDC, "ft_balance_of", { account_id: id }));
  const get = async (p, headers = {}, fetchImpl = fetch) => {
    const r = await fetchImpl(base + p, { headers });
    return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
  };

  let failures = 0;
  const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); if (!ok) failures++; };
  const blockers = [];
  const need = (ok, name, detail, why) => { console.log(`${ok ? "ok  " : "NOT "} ${name}${detail ? ` · ${detail}` : ""}`); if (!ok) blockers.push(why || name); };

  // ---------- what's there: reads only ----------
  console.log(`truth API ${base}, market ${MARKET}, USDC ${USDC}`);
  const info = await get(`/v1?fresh=${Date.now()}`);
  const pay = info.json?.credence?.payments ?? null;
  need(info.status === 200 && info.json?.network === "mainnet" && info.json?.contract === MARKET, "GET /v1 answers for the mainnet market", `HTTP ${info.status}, ${info.json?.network} ${info.json?.contract}`);
  need(!!pay, "payments are on", pay ? `${pay.protocol} v${pay.version} ${pay.network}: ${usd(pay.amount)} to ${pay.payTo}, facilitator ${pay.facilitator}` : '"payments": null', "payments are off: run scripts/mainnet/x402.mjs, scripts/vercel/secrets.mjs --network mainnet, and deploy");
  const payTo = pay?.payTo ?? dep.x402?.pay_to ?? dep.root;
  const relayer = dep.x402?.relayer ?? `x402.${dep.root}`;
  const price = BigInt(pay?.amount ?? dep.x402?.price_micro ?? 10000);
  need(pay ? pay.asset === USDC : true, "the asset is the deployment's USDC", pay?.asset ?? USDC);
  need(!!(await view(USDC, "storage_balance_of", { account_id: payTo })), `the pay-to ${payTo} is registered on USDC`, `holds ${usd(await held(payTo))}`);
  const relayerAcct = await rpc.call("query", { request_type: "view_account", finality: "final", account_id: relayer }).catch(() => null);
  const relayerNear = relayerAcct ? Number(BigInt(relayerAcct.amount) / 10n ** 21n) / 1000 : null;
  need(relayerNear !== null && relayerNear >= 0.01, `the relayer ${relayer} has gas`, relayerNear === null ? "no such account yet" : `${relayerNear} NEAR`, "no funded relayer: run scripts/mainnet/x402.mjs");

  const payer = payerOf(dep);
  const fund = BigInt(Math.round(Number(process.env.PAYER_FUND_USD || 0.05) * 1e6));
  need(!!payer.id && payer.id !== relayer && payer.id !== payTo, `the payer is ${payer.id} (${payer.from})`, "", "the payer can't be the relayer or the pay-to, and one must be named");
  const wallet = payer.id ? await held(payer.id) : 0n;
  const inMarket = payer.id ? BigInt((await view(MARKET, "get_balance", { trader: payer.id }).catch(() => "0")) ?? 0) : 0n;
  const registered = payer.id ? !!(await view(USDC, "storage_balance_of", { account_id: payer.id })) : false;
  const steps = [...(registered ? [] : ["register on USDC (0.00125 NEAR)"]), ...(wallet >= price ? [] : [`withdraw ${usd(fund)} from its market balance`])];
  need(wallet >= price || inMarket >= fund, "the payer can cover the price", `wallet ${usd(wallet)}, market ${usd(inMarket)}${steps.length ? `; the run would first ${steps.join(" and ")}` : ""}`);
  need(!!payer.sk, "the payer's key is on this machine", "", `no key for ${payer.id}`);

  console.log(`the run would: use up this address's ${info.json?.credence?.free_per_ip_per_day ?? 20} free calls, pay ${usd(price)} from ${payer.id} to ${payTo}, check both balances on chain, replay the payment and see it refused.`);
  if (plan) {
    console.log(blockers.length ? `NOT READY:\n  ${blockers.join("\n  ")}` : "READY: CONFIRM_MAINNET=yes node services/api/test/truth-smoke.mjs --network mainnet");
    console.log("plan only: nothing was spent, no key was used");
    return 0;
  }
  if (blockers.length) { console.error(`Not ready, nothing spent:\n  ${blockers.join("\n  ")}`); return 1; }

  // ---------- the payer's wallet ----------
  const provider = new JsonRpcProvider({ url: RPC_URLS[0] }, { retries: 4, backoff: 2, wait: 800 });
  const acct = new Account(payer.id, provider, new KeyPairSigner(KeyPair.fromString(payer.sk)));
  if (!registered) {
    const bounds = await view(USDC, "storage_balance_bounds");
    await acct.callFunction({ contractId: USDC, methodName: "storage_deposit", args: { account_id: payer.id, registration_only: true }, gas: 30n * TGAS, deposit: BigInt(bounds.min) });
    console.log(`ok   ${payer.id} registered on USDC`);
  }
  if (wallet < price) {
    await acct.callFunction({ contractId: MARKET, methodName: "withdraw", args: { amount_micro: String(fund) }, gas: 60n * TGAS });
    for (let i = 0; i < 12 && (await held(payer.id)) < price; i++) await sleep(1000);
    console.log(`ok   withdrew ${usd(fund)} to ${payer.id}'s wallet`);
  }

  // ---------- 1. the free tier ----------
  const limit = info.json.credence.free_per_ip_per_day;
  const counts = [];
  let challenge = null;
  for (let i = 0; i <= limit; i++) {
    const r = await get(PATH);
    if (r.status === 402) { challenge = r; break; }
    if (r.status !== 200) { check("a free call answers", false, `HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`); return 1; }
    counts.push(Number(r.headers.get("x-free-calls-remaining")));
  }
  check("the free tier counts every call once, across instances, then stops", !!challenge && counts.every((n, i) => i === 0 || n === counts[i - 1] - 1), `${counts.length} free calls left today, remaining ${counts.join(" ")}, then HTTP ${challenge?.status}`);
  if (!challenge) return 1;

  // ---------- 2. the challenge ----------
  const req = unb64json(challenge.headers.get("payment-required"));
  const acc = req.accepts[0];
  check("402 with the x402 v2 challenge, the same terms as GET /v1", req.x402Version === 2 && acc.network === "near:mainnet" && acc.asset === USDC && acc.amount === String(price) && acc.payTo === payTo, `${acc.scheme} ${acc.network}: ${acc.amount} micro-USDC to ${acc.payTo}`);

  // ---------- 3. one payment ----------
  const { createNearPaymentFetch } = await import("@fastnear/x402");
  const { createLocalNearSigner } = await import("@fastnear/x402/node");
  const [payToBefore, payerBefore] = [await held(payTo), await held(payer.id)];
  const paidCallsBefore = info.json.truth_api?.paid_calls ?? 0;
  let sent = null;
  const recording = (input, init) => {
    const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (h.get("payment-signature")) sent = h.get("payment-signature");
    return fetch(input, init);
  };
  const paidFetch = createNearPaymentFetch({ signer: createLocalNearSigner({ accountId: payer.id, secretKey: payer.sk, rpcUrls: { "near:mainnet": RPC_URLS[0] } }), network: "near:mainnet", fetch: recording });
  const t0 = Date.now();
  const paid = await get(PATH, {}, paidFetch);
  const ms = Date.now() - t0;
  const resp = paid.headers.get("payment-response") ? unb64json(paid.headers.get("payment-response")) : null;
  check("one payment: answered, with PAYMENT-RESPONSE and the receipt", paid.status === 200 && resp?.success === true && paid.json?.payment?.settled === true && paid.json?.claims?.length === 1, resp ? `settled in ${ms} ms, payer ${resp.payer}, ${paid.json?.payment?.explorer}` : `HTTP ${paid.status} ${JSON.stringify(paid.json)?.slice(0, 300)}`);
  if (!resp?.transaction) return 1;

  // ---------- 4. the chain ----------
  let payToAfter = payToBefore;
  for (let i = 0; i < 15 && payToAfter === payToBefore; i++) { payToAfter = await held(payTo); if (payToAfter === payToBefore) await sleep(1000); }
  const payerAfter = await held(payer.id);
  check("the chain agrees: the pay-to rose by the price, the payer fell by it", payToAfter - payToBefore === price && payerBefore - payerAfter === price, `pay-to +${payToAfter - payToBefore}, payer -${payerBefore - payerAfter} micro-USDC`);

  // ---------- 5. the replay ----------
  const replay = await get(PATH, { "payment-signature": sent });
  await sleep(2000);
  check("the same payment replayed is refused and moves nothing", !!sent && replay.status === 402 && !replay.json?.claims && /nonce/.test(replay.json?.error || "") && (await held(payTo)) === payToAfter, `HTTP ${replay.status}: ${replay.json?.error}`);

  // ---------- 6. the record ----------
  let after = null;
  for (let i = 0; i < 10; i++) { after = (await get(`/v1?fresh=${Date.now()}`)).json?.truth_api; if ((after?.paid_calls ?? 0) > paidCallsBefore) break; await sleep(1500); }
  check("GET /v1 reports it: truth_api counted the payment", after?.paid_calls === paidCallsBefore + 1 && after?.last_tx === resp.transaction, JSON.stringify(after));

  fs.mkdirSync(path.dirname(RECEIPT), { recursive: true });
  fs.writeFileSync(RECEIPT, JSON.stringify({ at: new Date().toISOString(), base, challenge: req, settlement: resp, receipt: paid.json.payment, truth_api: after, payer: payer.id, pay_to: payTo, relayer }, null, 1));
  console.log(failures ? `${failures} checks failed` : "all checks passed. Receipt: .apex-test/mainnet/truth-receipt.json");
  return failures ? 1 : 0;
}
