// The e2e's chain: services/api's offline mock RPC (blocks, chunks, AddKey for the lane),
// fronted by a shim that also executes the market's buy, sell and open_and_buy with the real
// LMSR (web/src/core/lmsr.ts, proven equal to crates/lmsr) and answers the market's views.
// Signed transactions are decoded and checked: a lane key must exist, allow the method and
// carry a fresh nonce, exactly as NEAR would require. Planner signatures are not checked here.
import http from "node:http";
import { createHash } from "node:crypto";
import { decodeSignedTransaction, baseEncode } from "near-api-js";
import { startMockRpc } from "../../services/api/test/mock-rpc.mjs";
import * as L from "../src/core/lmsr.ts";

const MICRO = 1_000_000n;
const b64json = (v) => Buffer.from(JSON.stringify(v)).toString("base64");

export async function startMarketShim({ marketId, laneAccountId, claims, models = {}, finalDelayMs = 900, execDelayMs = 250 }) {
  const mock = await startMockRpc({ blockMs: 250 });
  const markets = claims.map((c, id) => ({ id, text: c.text, page: c.page, kind: c.kind || "data", m: L.openMarket(BigInt(c.bMicro) * MICRO, BigInt(c.p0Ppm) * MICRO), trades: 0, volume: 0n, created: Date.now() }));
  const balances = new Map();
  const positions = new Map();
  const credited = new Set();
  const executed = new Map(); // tx hash -> { outcome, at }
  const stats = () => ({ claims: markets.length, challenges: 0, treasury_micro: "100000000", reserved_micro: "0", lane_budget_micro: "100000000", lane_credit_micro: "1000000", paused: false, held_micro: "0", balances_micro: "0", collected_micro: "0", payouts_micro: "0", bonds_micro: "0", bounties_micro: "0", rewrites_anchored: 0 });

  const view = (c) => {
    if (!c) return null;
    const p = L.priceYes(c.m);
    return {
      id: c.id, text: c.text, page: c.page, kind: c.kind, price_yes_ppm: Number(p / MICRO),
      cost_up_10_micro: String(L.costToMoveMicro(c.m, true)), cost_down_10_micro: String(L.costToMoveMicro(c.m, false)),
      status: "Open", outcome: null, provisional: null, trades: c.trades, volume_micro: String(c.volume), open_interest_micro: "0",
      collected_micro: "0", payout_left_micro: "0", challenge_id: null, prev: null, next: null, bounty_micro: "0",
    };
  };

  function views(method, args) {
    switch (method) {
      case "stats": return stats();
      case "get_claims": return markets.slice(args.from, args.from + Math.min(args.limit, 100)).map(view);
      case "get_claim": return view(markets[args.claim_id]);
      case "get_model": return models[args.model] ? { signing_address_hex: models[args.model], extras_json: "" } : null;
      case "get_balance": return String(balances.get(args.trader) ?? 0n);
      case "get_position": { const p = positions.get(`${args.claim_id}:${args.trader}`) || { yes: 0n, no: 0n }; return { yes_micro: String(p.yes), no_micro: String(p.no) }; }
      case "lane_claimable": return String((balances.get(args.trader) ?? 0n) > MICRO ? balances.get(args.trader) - MICRO : 0n);
      default: return undefined;
    }
  }

  const panic = (msg) => ({ Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${msg}` } } } } });

  function execute(method, args, trader) {
    const logs = [];
    const log = (event, data) => logs.push(`EVENT_JSON:${JSON.stringify({ standard: "pricedin", version: "2.0.0", event, data: [data] })}`);
    if (method === "open_and_buy") {
      const existing = markets.find((c) => c.page === args.page && c.text === args.text);
      const c = existing || { id: markets.length, text: args.text, page: args.page, kind: args.kind, m: L.openMarket(BigInt(args.b_micro) * MICRO, BigInt(args.p0_ppm) * MICRO), trades: 0, volume: 0n, created: Date.now() };
      if (!existing) { markets.push(c); log("open", { claim_id: c.id, p0_ppm: args.p0_ppm, b_micro: args.b_micro, reserve_micro: "1" }); }
      return buy(c.id, args.side, BigInt(args.amount_micro), trader, logs, log);
    }
    if (method === "buy") return buy(args.claim_id, args.side, BigInt(args.amount_micro), trader, logs, log);
    if (method === "sell") {
      const c = markets[args.claim_id];
      if (!c) return { status: panic("no such claim"), logs };
      const key = `${c.id}:${trader}`;
      const pos = positions.get(key) || { yes: 0n, no: 0n };
      const sh = BigInt(args.shares_micro);
      if (sh <= 0n || sh > pos[args.side]) return { status: panic("not enough shares"), logs };
      const before = Number(L.priceYes(c.m) / MICRO);
      const r = L.contractSell(c.m, args.side, sh);
      c.m = r.after; c.trades++; c.volume += r.proceedsMicro;
      pos[args.side] -= sh; positions.set(key, pos);
      const bal = (balances.get(trader) ?? 0n) + r.proceedsMicro; balances.set(trader, bal);
      const after = Number(L.priceYes(c.m) / MICRO);
      log("trade", { claim_id: c.id, trader, side: `sell_${args.side}`, shares_micro: String(sh), amount_micro: String(r.proceedsMicro), price_yes_ppm: after, balance_micro: String(bal) });
      return { status: { SuccessValue: b64json({ claim_id: c.id, trader, side: `sell_${args.side}`, shares_micro: String(sh), amount_micro: String(r.proceedsMicro), price_yes_ppm_before: before, price_yes_ppm_after: after, balance_micro: String(bal) }) }, logs };
    }
    return { status: panic(`method ${method} is not in this shim`), logs };
  }

  function buy(id, side, amount, trader, logs, log) {
    const c = markets[id];
    if (!c) return { status: panic("no such claim"), logs };
    if (trader.startsWith("lane:") && !credited.has(trader)) {
      credited.add(trader);
      balances.set(trader, (balances.get(trader) ?? 0n) + MICRO);
      log("lane_credit", { trader, amount_micro: String(MICRO) });
    }
    const bal = balances.get(trader) ?? 0n;
    if (amount <= 0n || amount > bal) return { status: panic("not enough balance"), logs };
    const before = Number(L.priceYes(c.m) / MICRO);
    const r = L.contractBuy(c.m, side, amount);
    if (r.sharesMicro <= 0n) return { status: panic("amount too small"), logs };
    c.m = r.after; c.trades++; c.volume += r.chargedMicro;
    const key = `${id}:${trader}`;
    const pos = positions.get(key) || { yes: 0n, no: 0n };
    pos[side] += r.sharesMicro; positions.set(key, pos);
    const left = bal - r.chargedMicro; balances.set(trader, left);
    const after = Number(L.priceYes(c.m) / MICRO);
    log("trade", { claim_id: id, trader, side, shares_micro: String(r.sharesMicro), amount_micro: String(r.chargedMicro), price_yes_ppm: after, balance_micro: String(left) });
    return { status: { SuccessValue: b64json({ claim_id: id, trader, side, shares_micro: String(r.sharesMicro), amount_micro: String(r.chargedMicro), price_yes_ppm_before: before, price_yes_ppm_after: after, balance_micro: String(left) }) }, logs };
  }

  const err = (cause, info = {}) => ({ error: { name: "HANDLER_ERROR", cause: { name: cause, info }, data: info, code: -32000, message: "Server error" } });

  async function handle(method, params) {
    if (method === "query" && params?.request_type === "call_function" && params.account_id === marketId) {
      const args = JSON.parse(Buffer.from(params.args_base64 || "", "base64").toString() || "{}");
      const v = views(params.method_name, args);
      if (v !== undefined) return { result: { result: [...Buffer.from(JSON.stringify(v))], logs: [], block_height: mock.st.height, block_hash: "x" } };
      return err("CONTRACT_EXECUTION_ERROR", { vm_error: "MethodNotFound" });
    }
    if (method === "send_tx" || method === "broadcast_tx_async") {
      const b64 = Array.isArray(params) ? params[0] : params.signed_tx_base64;
      const stx = decodeSignedTransaction(Buffer.from(b64, "base64"));
      const t = stx.transaction;
      if (t.receiverId !== marketId) return null; // lane AddKey and anything else: the mock handles it
      const hash = baseEncode(createHash("sha256").update(t.encode()).digest());
      if (executed.has(hash)) return { result: method === "send_tx" ? executed.get(hash).outcome : hash };
      const pk = t.publicKey.toString();
      const ak = mock.st.keys.get(`${t.signerId}|${pk}`);
      if (!ak) return err("INVALID_TRANSACTION", { InvalidTxError: { InvalidAccessKeyError: { AccessKeyNotFound: { account_id: t.signerId, public_key: pk } } } });
      if (BigInt(t.nonce) <= BigInt(ak.nonce)) return err("INVALID_TRANSACTION", { InvalidTxError: { InvalidNonce: { tx_nonce: String(t.nonce), ak_nonce: String(ak.nonce) } } });
      const fc = t.actions[0]?.functionCall;
      const perm = ak.permission?.FunctionCall;
      if (!fc || (perm && !perm.method_names.includes(fc.methodName))) return err("INVALID_TRANSACTION", { InvalidTxError: { InvalidAccessKeyError: { MethodNameMismatch: { method_name: fc?.methodName } } } });
      ak.nonce = String(t.nonce);
      await new Promise((r) => setTimeout(r, execDelayMs));
      const trader = t.signerId === laneAccountId ? `lane:${pk}` : t.signerId;
      const args = JSON.parse(Buffer.from(Uint8Array.from(fc.args)).toString("utf8"));
      const r = execute(fc.methodName, args, trader);
      const h = mock.st.height + 1;
      const outcome = {
        status: r.status, transaction: { hash, signer_id: t.signerId }, transaction_outcome: { id: hash },
        receipts_outcome: [{ id: baseEncode(createHash("sha256").update(`receipt${hash}`).digest()), block_hash: "x", outcome: { executor_id: marketId, logs: r.logs, status: r.status } }],
        final_execution_status: "EXECUTED_OPTIMISTIC",
      };
      executed.set(hash, { outcome, at: Date.now() });
      if (!mock.st.txsAt.has(h)) mock.st.txsAt.set(h, []);
      mock.st.txsAt.get(h).push({ hash, signer_id: t.signerId, receiver_id: marketId, actions: [{ FunctionCall: { method_name: fc.methodName, args: "", gas: 1, deposit: "0" } }], public_key: pk, nonce: Number(t.nonce), signature: "ed25519:x" });
      return { result: method === "send_tx" ? outcome : hash };
    }
    if ((method === "EXPERIMENTAL_tx_status" || method === "tx") && executed.has(params?.tx_hash)) {
      const e = executed.get(params.tx_hash);
      if (params.wait_until === "FINAL") {
        const wait = e.at + finalDelayMs - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        return { result: { ...e.outcome, final_execution_status: "FINAL" } };
      }
      return { result: e.outcome };
    }
    return null;
  }

  const servers = [];
  async function serve() {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        res.setHeader("access-control-allow-origin", "*");
        res.setHeader("access-control-allow-headers", "content-type");
        if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
        let j;
        try { j = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
        let r = null;
        try { r = await handle(j.method, j.params); } catch (e) { r = err("INTERNAL_ERROR", { message: String(e?.message || e) }); }
        if (r) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id, ...r })); }
        const up = await fetch(mock.url, { method: "POST", headers: { "content-type": "application/json" }, body });
        res.writeHead(up.status, { "content-type": "application/json" });
        res.end(await up.text());
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
  }

  const urls = [await serve(), await serve()];
  return {
    urls, mock, markets,
    async close() {
      for (const s of servers) { s.closeAllConnections?.(); await new Promise((r) => s.close(() => r())); }
      await mock.close();
    },
  };
}
