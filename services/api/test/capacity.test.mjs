// readCapacity (api/_lib/news.mjs): what the news gate knows about the market's money. The reserve cap lives
// only in the market's raw STATE, and on 13 November 2026 that state passed 50 KB: most public RPCs then
// refuse to list it (TOO_LARGE_CONTRACT_STATE), and the gate opened nothing. These tests hold the two ways out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readCapacity, STATE_RPCS } from "../../../api/_lib/news.mjs";
import { headroomMicro } from "../../ai/src/gate.js";

const MARKET = "market.isitpriced.near";
const str = (s) => { const b = Buffer.from(s); const n = Buffer.alloc(4); n.writeUInt32LE(b.length); return Buffer.concat([n, b]); };
const u128 = (v) => { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt(v) & ((1n << 64n) - 1n), 0); b.writeBigUInt64LE(BigInt(v) >> 64n, 8); return b; };
// the market's state as it stood that evening: treasury $10.09, reserved $53.13, cap $53.76
const state = Buffer.concat([
  str("isitpriced.near"), Buffer.from([0]), str("usdc"), str("lane.isitpriced.near"), Buffer.from([1]), str("swarm.x"), Buffer.from([0]),
  str("o"), str("h"), str("k".repeat(32)), str("c"), Buffer.alloc(8), str("r"), str("b"), str("p"), str("l"),
  u128(10_088_691), u128(53_126_778), u128(53_763_479), Buffer.alloc(40),
]);
const listed = { values: [{ key: Buffer.from("STATE").toString("base64"), value: state.toString("base64") }] };
const stats = { treasury_micro: "10088691", reserved_micro: "53126778", lane_budget_micro: "8000000" };
const tooLarge = () => Object.assign(new Error(`State of contract ${MARKET} is too large to be viewed`), { name: "TOO_LARGE_CONTRACT_STATE" });

/** A pool whose nodes all refuse the state (or serve it), and answer the two small reads. */
const pool = ({ servesState = false, statsFail = false } = {}) => ({
  viewFunction: async (id, method) => { assert.deepEqual([id, method], [MARKET, "stats"]); if (statsFail) throw new Error("no answer"); return stats; },
  call: async (method, params) => {
    if (params.request_type === "view_account") return { amount: "5291000000000000000000000", storage_usage: 486_695 };
    assert.equal(params.prefix_base64, Buffer.from("STATE").toString("base64"));
    if (!servesState) throw tooLarge();
    return listed;
  },
});
/** A fetch for the fallback nodes: `answers` maps a URL to a JSON body, an Error to throw, or nothing (HTTP 500). */
const fetchOf = (answers, seen = []) => Object.assign(async (url, init) => {
  seen.push(url);
  assert.equal(JSON.parse(init.body).params.request_type, "view_state");
  const a = answers[url];
  if (a instanceof Error) throw a;
  return { json: async () => a ?? { error: { name: "HANDLER_ERROR" } } };
}, { seen });

test("capacity: a pool that lists the state gives the cap, and asks no other node", async () => {
  const f = fetchOf({});
  const c = await readCapacity(pool({ servesState: true }), MARKET, { fetchImpl: f });
  assert.deepEqual(c, { treasuryMicro: "10088691", reservedMicro: "53126778", laneBudgetMicro: "8000000", spareNear: 0.424, capMicro: "53763479", capRead: true });
  assert.deepEqual(f.seen, []);
});

test("capacity: when the pool refuses a state past 50 KB, a node that still lists it gives the cap", async () => {
  const f = fetchOf({ [STATE_RPCS[0]]: new Error("no answer in time"), [STATE_RPCS[1]]: { result: listed } });
  const c = await readCapacity(pool(), MARKET, { fetchImpl: f });
  assert.deepEqual([c.capMicro, c.capRead], ["53763479", true]);
  assert.deepEqual(f.seen, STATE_RPCS, "the first fallback failed, so the second was asked");
  // the room that evening: $0.59 by the treasury (10.09 less the $8 of free bets and the $1.50 floor), $0.64 under the cap
  assert.equal(headroomMicro({ ...c, floorMicro: 1_500_000 }), 588_691);
});

test("capacity: when no node lists the state, the gate goes by the treasury and the contract keeps the cap", async () => {
  const f = fetchOf({});
  const c = await readCapacity(pool(), MARKET, { fetchImpl: f });
  assert.equal(c.capRead, false);
  assert.equal(c.capMicro, String(53_126_778 + 10_088_691), "an assumed cap the treasury can't reach");
  assert.equal(headroomMicro({ ...c, floorMicro: 1_500_000 }), 588_691, "the same room the treasury gave with the cap read: never more than it holds above the free bets and the floor");
  assert.deepEqual(f.seen, STATE_RPCS);
});

test("capacity: stats unread, or a state that doesn't parse, is still null: the gate opens nothing", async () => {
  assert.equal(await readCapacity(pool({ statsFail: true }), MARKET, { fetchImpl: fetchOf({}) }), null);
  const cut = { result: { values: [{ key: listed.values[0].key, value: state.subarray(0, 60).toString("base64") }] } };
  assert.equal(await readCapacity(pool(), MARKET, { fetchImpl: fetchOf({ [STATE_RPCS[0]]: cut }) }), null);
});
