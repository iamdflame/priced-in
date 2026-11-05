import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareBill, Biller } from "../src/billing.js";
import { Ledger } from "../src/ledger.js";
import { Journal } from "../src/journal.js";
import { fakeSigner, swarmAgent } from "./helpers-ai.mjs";

const A = "a0.swarm.testnet";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const call = (ledger, nano) => ledger.write({ t: "call", id: `call:${++ledger.seq}:c`, at: new Date().toISOString(), agent: A, purpose: "credence 0", model: "m", chat_id: "c", request_hash: "r", prompt_tokens: 10, completion_tokens: 2, cached_tokens: 0, cost_usd: nano / 1e9, nano_usd: nano });
const roster = (o = {}) => [{ ...swarmAgent(0, { model: "m", ...o }), billing: o.billing || "escrow" }];

test("a bill: nano-USD rounded down to micro, the remainder carried, debt added, hash over the exact usage JSON", () => {
  const b = prepareBill({ agent: A, route: "escrow", unbilled: { calls: [{ id: "c1", nano_usd: 1500 }, { id: "c2", nano_usd: 2700 }], carry_in_nano: 300, debt_in_micro: 10n }, rateYoctoPerMicro: 7n, at: "t" });
  assert.equal(b.due_micro, 14n, "(1500 + 2700 + 300) nano = 4 micro + 500 carried, plus 10 owed");
  assert.equal(b.carry_out_nano, 500n);
  assert.equal(b.charge_micro, 14n);
  assert.equal(b.usage.charge_yocto, "98");
  assert.equal(b.usage_hash, sha(b.usage_json));
  assert.deepEqual(b.call_ids, ["c1", "c2"]);
  assert.equal(prepareBill({ agent: A, route: "escrow", unbilled: { calls: [{ id: "c1", nano_usd: 1500 }], carry_in_nano: 300, debt_in_micro: 10n }, rateYoctoPerMicro: 7n, at: "t" }).usage_hash, prepareBill({ agent: A, route: "escrow", unbilled: { calls: [{ id: "c1", nano_usd: 1500 }], carry_in_nano: 300, debt_in_micro: 10n }, rateYoctoPerMicro: 7n, at: "t" }).usage_hash, "deterministic");
  assert.equal(prepareBill({ agent: A, route: "balance", unbilled: { calls: [{ id: "c1", nano_usd: 999 }], carry_in_nano: 0, debt_in_micro: 0n }, at: "t" }), null, "less than a micro-USD waits");
  assert.equal(prepareBill({ agent: A, route: "balance", unbilled: { calls: [{ id: "c1", nano_usd: 5000 }], carry_in_nano: 0, debt_in_micro: 0n }, at: "t", cap: 3n }).charge_micro, 3n, "a balance bill is capped at the bankroll");
  assert.equal(prepareBill({ agent: A, route: "balance", unbilled: { calls: [], blocked: "x" }, at: "t" }), null);
});

test("escrow bills: the swarm takes what is left, the agent sleeps, the rest is owed after a top-up", async () => {
  const ledger = new Ledger({ journal: new Journal(null) });
  const signer = fakeSigner([]);
  const biller = new Biller({ ledger, signer, rateYoctoPerMicro: 10n, balanceOf: async () => 0 });
  call(ledger, 75_000_000); // $0.075
  signer.billReply = (b) => ({ ok: true, final: true, txHash: "s1", value: String(65_000n * 10n) }); // escrow held $0.065
  const r = roster({ escrow_yocto: "650000" });
  const [done] = await biller.cycle(r);
  assert.equal(done.ok, true);
  assert.equal(done.short, true);
  assert.equal(signer.bills[0].route, "escrow");
  assert.equal(signer.bills[0].amount_micro, "75000");
  assert.equal(r[0].swarm.sleeping, true, "asleep within the same cycle");
  assert.equal(ledger.debt(A), 10_000n);
  assert.equal(ledger.unbilled(A).calls.length, 0, "the calls are billed even though part is owed");
  assert.equal((await biller.cycle(r)).length, 0, "nothing more to sweep while asleep");
  // a top-up wakes it: the next bill carries the debt
  call(ledger, 2_000);
  signer.billReply = (b) => ({ ok: true, final: true, txHash: "s2", value: String(BigInt(b.amount_micro) * 10n) });
  await biller.cycle(roster({ escrow_yocto: "999999999" }));
  assert.equal(signer.bills[1].amount_micro, "10002");
  assert.equal(ledger.debt(A), 0n);
  const p = ledger.pnl()[A];
  assert.equal(p.swept_yocto, 750_020n);
  assert.equal(p.swept_micro, 75_002n);
  assert.equal(p.bills, 2);
  const usage = JSON.parse(ledger.billByHash(signer.bills[1].usage_hash).intent.usage_json);
  assert.equal(usage.debt_in_micro, "10000");
});

test("balance bills: charged from the bankroll up to what it holds; a failed bill returns its calls; an open one blocks", async () => {
  const ledger = new Ledger({ journal: new Journal(null) });
  const signer = fakeSigner([]);
  const biller = new Biller({ ledger, signer, rateYoctoPerMicro: 10n, balanceOf: async () => 0.0004 });
  call(ledger, 1_000_000); // 1000 micro
  await biller.cycle(roster({ billing: "balance" }));
  assert.equal(signer.bills[0].route, "balance");
  assert.equal(signer.bills[0].amount_micro, "400");
  assert.equal(ledger.debt(A), 600n);
  assert.equal(ledger.pnl()[A].charged_micro, 400n);
  // a clear failure: nothing was billed, the calls come back
  const l2 = new Ledger({ journal: new Journal(null) });
  const b2 = new Biller({ ledger: l2, signer, rateYoctoPerMicro: 10n, balanceOf: async () => 1 });
  call(l2, 3_000_000);
  signer.billReply = () => ({ ok: false, final: true, error: "the agent's balance can't cover this charge" });
  await b2.cycle(roster({ billing: "balance" }));
  assert.equal(l2.unbilled(A).calls.length, 1);
  assert.equal(l2.debt(A), 0n);
  // an unknown outcome blocks the next bill until the signer resolves it
  signer.billReply = () => ({ ok: false, final: false, pending: true, error: "sent, outcome unknown" });
  await b2.cycle(roster({ billing: "balance" }));
  assert.match(l2.unbilled(A).blocked, /no final outcome/);
  const n = signer.bills.length;
  signer.outcomeReply = { ok: true, final: true, txHash: "late", value: null };
  await b2.cycle(roster({ billing: "balance" }));
  assert.equal(signer.bills.length, n, "resolved, not re-sent");
  assert.equal(l2.unbilled(A).blocked, null);
  assert.equal(l2.pnl()[A].charged_micro, 3000n);
});
