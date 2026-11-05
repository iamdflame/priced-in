import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEventLogs, extractMarketEvents, txReachesMarket, EventHub, Scanner } from "../src/events.mjs";
import { Rpc } from "../src/rpc.mjs";
import { startMockRpc, eventLog } from "./mock-rpc.mjs";

// a log line exactly as the contract's log() writes it
const TRADE = 'EVENT_JSON:{"standard":"pricedin","version":"1.0.0","event":"trade","data":[{"claim_id":0,"trader":"lane:ed25519:abc","side":"no","shares_micro":"1964913","amount_micro":"1000000","price_yes_ppm":321000}]}';

test("parses the contract's EVENT_JSON lines", () => {
  const [e] = parseEventLogs([TRADE]);
  assert.equal(e.event, "trade");
  assert.equal(e.version, "1.0.0");
  assert.equal(e.data.trader, "lane:ed25519:abc");
  assert.equal(e.data.price_yes_ppm, 321000);
  assert.equal(e.logIndex, 0);
});

test("ignores other standards, plain logs, malformed JSON and non-arrays", () => {
  const logs = [
    "plain text log",
    'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{}]}',
    "EVENT_JSON:{not json",
    'EVENT_JSON:{"standard":"pricedin","data":[{}]}',
    null,
    'EVENT_JSON:{"standard":"pricedin","version":"1.0.0","event":"open","data":[{"claim_id":1,"p0_ppm":600000,"b_micro":"1000000"}]}',
  ];
  const out = parseEventLogs(logs);
  assert.equal(out.length, 1);
  assert.equal(out[0].event, "open");
  assert.equal(out[0].logIndex, 5);
  assert.deepEqual(parseEventLogs("nope"), []);
});

test("every data element becomes its own record", () => {
  const out = parseEventLogs(['EVENT_JSON:{"standard":"pricedin","version":"1.0.0","event":"settle","data":[{"claim_id":1},{"claim_id":2}]}']);
  assert.deepEqual(out.map((e) => e.data.claim_id), [1, 2]);
  assert.deepEqual(out.map((e) => e.dataIndex), [0, 1]);
});

test("extracts only receipts the market executed, with stable ids", () => {
  const tx = {
    receipts_outcome: [
      { id: "R1", block_hash: "B1", outcome: { executor_id: "market.testnet", logs: [TRADE] } },
      { id: "R2", block_hash: "B1", outcome: { executor_id: "usdc.testnet", logs: [TRADE.replace("trade", "spoof")] } },
      { id: "R3", block_hash: "B2", outcome: { executor_id: "market.testnet", logs: [] } },
    ],
  };
  const out = extractMarketEvents(tx, "market.testnet");
  assert.equal(out.length, 1);
  assert.equal(out[0].uid, "R1:0:0");
  assert.equal(out[0].receiptId, "R1");
  assert.deepEqual(extractMarketEvents({}, "market.testnet"), []);
});

test("which transactions can reach the market", () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
  const M = "market.testnet", U = "usdc.testnet";
  assert.equal(txReachesMarket({ receiver_id: M, actions: [] }, M, U), true);
  assert.equal(txReachesMarket({ receiver_id: "other.testnet", actions: [] }, M, U), false);
  const dep = { receiver_id: U, actions: [{ FunctionCall: { method_name: "ft_transfer_call", args: b64({ receiver_id: M, amount: "1", msg: "" }) } }] };
  assert.equal(txReachesMarket(dep, M, U), true, "a deposit through the token");
  assert.equal(txReachesMarket(dep, M, null), false, "without USDC_CONTRACT_ID deposits are not followed");
  const elsewhere = { receiver_id: U, actions: [{ FunctionCall: { method_name: "ft_transfer_call", args: b64({ receiver_id: "dex.testnet" }) } }] };
  assert.equal(txReachesMarket(elsewhere, M, U), false);
  const meta = { receiver_id: "user.testnet", actions: [{ Delegate: { delegate_action: { receiver_id: M, actions: [] } } }] };
  assert.equal(txReachesMarket(meta, M, U), true, "a meta-transaction to the market");
  assert.equal(txReachesMarket({ receiver_id: M }, null), false);
  assert.equal(txReachesMarket({ receiver_id: U, actions: ["CreateAccount", { FunctionCall: { method_name: "ft_transfer_call", args: "%%%" } }] }, M, U), false);
});

test("the hub keeps the last N events, drops duplicates and fans out", () => {
  const hub = new EventHub({ size: 200 });
  const got = [];
  const unsub = hub.subscribe((e) => got.push(e.seq));
  hub.subscribe(() => { throw new Error("a broken subscriber"); });
  for (let i = 0; i < 250; i++) hub.publish({ uid: `u${i}`, event: "trade" });
  assert.equal(hub.publish({ uid: "u249", event: "trade" }), null, "duplicate dropped");
  assert.equal(hub.buf.length, 200);
  assert.equal(hub.buf[0].seq, 51);
  assert.equal(got.length, 250);
  assert.deepEqual(hub.since(245).map((e) => e.seq), [246, 247, 248, 249, 250]);
  unsub();
  hub.publish({ uid: "z", event: "open" });
  assert.equal(got.length, 250);
});

test("the scanner reads new blocks' chunks and publishes the market's events, skipping missing heights", async (t) => {
  const mock = await startMockRpc({ blockMs: 100, skipHeights: [1001, 1002] });
  t.after(() => mock.close());
  const hub = new EventHub();
  const rpc = new Rpc([mock.url]);
  const scanner = new Scanner({ rpc, marketId: "market.testnet", usdcId: "usdc.testnet", hub, intervalMs: 100 });
  scanner.start();
  t.after(() => scanner.stop());
  const got = new Promise((resolve) => hub.subscribe(resolve));
  await new Promise((r) => setTimeout(r, 450));
  mock.injectTx({ hash: "TxA", signerId: "lane.testnet", receiverId: "market.testnet", logs: [eventLog("trade", { claim_id: 3, trader: "lane:ed25519:k", side: "yes", amount_micro: "1000000", price_yes_ppm: 610000 })], delayMs: 150 });
  mock.injectTx({ hash: "TxB", signerId: "x.testnet", receiverId: "other.testnet", logs: [eventLog("trade", { claim_id: 9 })] });
  const e = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error("no event in 4 s")), 4000))]);
  assert.equal(e.event, "trade");
  assert.equal(e.data.claim_id, 3);
  assert.equal(e.txHash, "TxA");
  assert.equal(e.signerId, "lane.testnet");
  assert.ok(e.blockHeight > 1000);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(hub.buf.length, 1, "the unrelated transaction was not followed");
  assert.ok(scanner.state.lastHeight >= 1004, "scanned past the skipped heights");
  assert.equal(scanner.state.txsTracked, 1);
});

test("the scanner fails over to the second RPC when the first is down", async (t) => {
  const mock = await startMockRpc({ blockMs: 100 });
  t.after(() => mock.close());
  const hub = new EventHub();
  const rpc = new Rpc(["http://127.0.0.1:1", mock.url], { timeoutMs: 1000 });
  const scanner = new Scanner({ rpc, marketId: "market.testnet", hub, intervalMs: 100 });
  scanner.start();
  t.after(() => scanner.stop());
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(scanner.state.blocksScanned > 0);
  assert.ok(Date.now() - scanner.state.lastScanAt < 1000);
});
