import test from "node:test";
import assert from "node:assert/strict";
import { scanEvents, rebuild, compare, markMicro, pnlMicro } from "../src/pnl.js";
import { Ledger } from "../src/ledger.js";
import { Journal } from "../src/journal.js";
import { Rpc } from "../../api/src/rpc.mjs";
import { startMockRpc } from "../../api/test/mock-rpc.mjs";

const M = "market.testnet", S = "swarm.testnet", U = "usdc.testnet", A = `a0.${S}`, B = `a1.${S}`;
const ev = (contract, event, data) => ({ uid: `${event}:${Math.random()}`, contract, standard: contract === M ? "pricedin" : "pricedin-swarm", event, data });
const log = (standard, event, data) => `EVENT_JSON:${JSON.stringify({ standard, version: "2.0.0", event, data: [data] })}`;

function events() {
  return [
    ev(S, "spawn", { agent: A, owner: "bob.testnet", model: "m", persona_hash: "0".repeat(64), escrow_yocto: "1000" }),
    ev(M, "deposit", { to: A, trader: A, amount_micro: "5000000", balance_micro: "5000000" }),
    ev(M, "trade", { claim_id: 0, trader: A, side: "yes", shares_micro: "2000000", amount_micro: "900000", price_yes_ppm: 600000 }),
    ev(M, "trade", { claim_id: 0, trader: A, side: "sell_yes", shares_micro: "500000", amount_micro: "300000", price_yes_ppm: 560000 }),
    ev(M, "trade", { claim_id: 1, trader: A, side: "no", shares_micro: "1000000", amount_micro: "400000", price_yes_ppm: 450000 }),
    ev(M, "trade", { claim_id: 0, trader: "alice.testnet", side: "no", shares_micro: "1", amount_micro: "1", price_yes_ppm: 1 }),
    ev(M, "charge", { trader: A, amount_micro: "1234", usage_hash: "a".repeat(64), balance_micro: "1" }),
    ev(S, "sweep", { agent: A, amount_yocto: "700", usage_hash: "b".repeat(64), escrow_yocto: "300", sleeping: false }),
    ev(S, "top_up", { agent: A, amount_yocto: "50", escrow_yocto: "350" }),
    ev(M, "redeem", { claim_id: 1, trader: A, side: "no", shares_micro: "1000000", amount_micro: "1000000", balance_micro: "1" }),
    ev(M, "agent_release", { trader: A, to: "bob.testnet", amount_micro: "100000", balance_micro: "1", to_balance_micro: "1" }),
  ];
}

function runnerLedger() {
  const l = new Ledger({ journal: new Journal(null) });
  const ok = (id, kind, extra, value) => { l.recordIntent({ id, kind, agent: A, ...extra }); l.recordOutcome(id, { ok: true, txHash: id, value }); };
  ok("t1", "trade", { claim_id: 0 }, { claim_id: 0, side: "yes", shares_micro: "2000000", amount_micro: "900000" });
  ok("t2", "trade", { claim_id: 0 }, { claim_id: 0, side: "sell_yes", shares_micro: "500000", amount_micro: "300000" });
  ok("t3", "trade", { claim_id: 1 }, { claim_id: 1, side: "no", shares_micro: "1000000", amount_micro: "400000" });
  ok("b1", "bill", { route: "balance", amount_micro: "1234", due_micro: "1234" }, null);
  ok("b2", "bill", { route: "escrow", amount_micro: "70", due_micro: "70", rate_yocto_per_micro: "10" }, "700");
  ok("r1", "redeem", { claim_id: 1 }, "1000000");
  return l;
}

test("rebuild from events: trades, sales, redemptions, both inference routes, capital in and out", () => {
  const rows = rebuild(events(), { market: M, swarm: S, rate: 10n });
  assert.deepEqual(Object.keys(rows), [A], "only swarm agents: alice's trade is not an agent's");
  const r = rows[A];
  assert.equal(r.cost_micro, 1_300_000n);
  assert.equal(r.proceeds_micro, 300_000n);
  assert.equal(r.redeemed_micro, 1_000_000n);
  assert.equal(r.charged_micro, 1234n);
  assert.equal(r.swept_yocto, 700n);
  assert.equal(r.swept_micro, 70n);
  assert.equal(r.bills, 2);
  assert.deepEqual(r.positions, { 0: { yes: 1_500_000n, no: 0n }, 1: { yes: 0n, no: 0n } }, "a redemption clears the claim");
  assert.equal(r.deposited_micro, 5_000_000n);
  assert.equal(r.released_micro, 100_000n);
  assert.equal(r.spawn_escrow_yocto + r.top_up_yocto - r.swept_yocto, 350n);
  const prices = new Map([[0, { price_yes_ppm: 560000, outcome: null }]]);
  assert.equal(markMicro(r.positions, prices), 840_000n);
  assert.equal(pnlMicro(r, prices), 300_000n + 1_000_000n - 1_300_000n - 1234n - 70n + 840_000n);
});

test("the runner's ledger matches the chain to the micro-USDC and the yoctoNEAR, and any difference is named", () => {
  const prices = new Map([[0, { price_yes_ppm: 560000, outcome: null }]]);
  const chain = rebuild(events(), { market: M, swarm: S, rate: 10n });
  const [ok] = compare(chain, runnerLedger().pnl(), prices);
  assert.equal(ok.ok, true, ok.diffs.join("; "));
  const l = runnerLedger();
  l.recordIntent({ id: "t9", kind: "trade", agent: A, claim_id: 0 });
  l.recordOutcome("t9", { ok: true, value: { claim_id: 0, side: "yes", shares_micro: "1", amount_micro: "1" } });
  const [bad] = compare(chain, l.pnl(), prices);
  assert.equal(bad.ok, false);
  assert.ok(bad.diffs.some((d) => /cost_micro: chain 1300000 vs runner 1300001/.test(d)));
  assert.ok(bad.diffs.some((d) => /positions/.test(d)));
  const missing = compare({ ...chain, [B]: rebuild([ev(M, "trade", { claim_id: 0, trader: B, side: "yes", shares_micro: "5", amount_micro: "5" })], { market: M, swarm: S, rate: 10n })[B] }, runnerLedger().pnl(), prices);
  assert.equal(missing.find((x) => x.account === B).ok, false, "a trade the runner never recorded is caught");
});

test("scan: market and swarm events from blocks, deposits through the token, a release inside a swarm transaction", async (t) => {
  const mock = await startMockRpc({ blockMs: 60 });
  t.after(() => mock.close());
  const rpc = new Rpc([mock.url]);
  const from = mock.st.height + 1;
  mock.injectTx({ hash: "tx-trade", signerId: A, receiverId: M, logs: [log("pricedin", "trade", { claim_id: 0, trader: A, side: "yes", shares_micro: "2000000", amount_micro: "900000", price_yes_ppm: 600000 })] });
  await new Promise((r) => setTimeout(r, 150));
  mock.injectTx({ hash: "tx-deposit", signerId: "bob.testnet", receiverId: U, actions: [{ FunctionCall: { method_name: "ft_transfer_call", args: Buffer.from(JSON.stringify({ receiver_id: M, amount: "5", msg: "" })).toString("base64"), gas: 1, deposit: "1" } }], executorId: M, logs: [log("pricedin", "deposit", { to: A, trader: A, amount_micro: "5000000", balance_micro: "5000000" })] });
  await new Promise((r) => setTimeout(r, 150));
  mock.injectTx({ hash: "tx-sweep", signerId: "house.testnet", receiverId: S, logs: [log("pricedin-swarm", "sweep", { agent: A, amount_yocto: "700", usage_hash: "b".repeat(64), escrow_yocto: "0", sleeping: true })] });
  await new Promise((r) => setTimeout(r, 150));
  mock.injectTx({ hash: "tx-close", signerId: "bob.testnet", receiverId: S, executorId: M, logs: [log("pricedin", "agent_release", { trader: A, to: "bob.testnet", amount_micro: "100000", balance_micro: "0", to_balance_micro: "1" })] });
  mock.injectTx({ hash: "tx-other", signerId: "x.testnet", receiverId: "elsewhere.testnet", logs: [log("pricedin", "trade", { claim_id: 0, trader: A, side: "yes", shares_micro: "9", amount_micro: "9" })] });
  await new Promise((r) => setTimeout(r, 400));
  const scan = await scanEvents({ rpc, market: M, swarm: S, usdc: U, from });
  assert.deepEqual(scan.events.map((e) => e.event).sort(), ["agent_release", "deposit", "sweep", "trade"]);
  assert.equal(scan.events.find((e) => e.event === "agent_release").contract, M);
  const rows = rebuild(scan.events, { market: M, swarm: S, rate: 10n });
  assert.equal(rows[A].cost_micro, 900000n);
  assert.equal(rows[A].released_micro, 100000n);
  assert.equal(rows[A].swept_micro, 70n);
  // incremental: a cached scan reads only the new blocks and keeps the old events
  mock.injectTx({ hash: "tx-trade-2", signerId: A, receiverId: M, logs: [log("pricedin", "trade", { claim_id: 0, trader: A, side: "sell_yes", shares_micro: "1", amount_micro: "1", price_yes_ppm: 1 })] });
  await new Promise((r) => setTimeout(r, 300));
  const again = await scanEvents({ rpc, market: M, swarm: S, usdc: U, from, cache: JSON.parse(JSON.stringify(scan)) });
  assert.equal(again.events.length, 5);
  assert.equal(new Set(again.events.map((e) => e.uid)).size, 5, "no event counted twice");
});
