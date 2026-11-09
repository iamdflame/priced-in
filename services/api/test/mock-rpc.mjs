// A small in-process NEAR JSON-RPC stand-in for offline tests. It produces blocks, serves
// chunks and transaction outcomes, answers the market's views, and applies AddKey actions
// from signed transactions so the lane path can run end to end without a network.
import http from "node:http";
import { decodeSignedTransaction, baseEncode } from "near-api-js";
import { createHash } from "node:crypto";

const EMPTY = "11111111111111111111111111111111";
const b58 = (s) => baseEncode(createHash("sha256").update(String(s)).digest());

export async function startMockRpc({ chainId = "testnet", blockMs = 200, startHeight = 1000, skipHeights = [] } = {}) {
  const st = {
    height: startHeight,
    txsAt: new Map(), // height -> [chunk tx view]
    outcomes: new Map(), // txHash -> outcome
    keys: new Map(), // `${account}|${pk}` -> access key view
    stats: { claims: 0, treasury_micro: "10000000", reserved_micro: "0", lane_budget_micro: "10000000", lane_credit_micro: "1000000", paused: false },
    claims: [],
    views: new Map(), // extra view methods: name -> (args, accountId) => value
    accounts: new Map(), // accountId -> view_account fields that differ from the default 5 NEAR
    calls: [],
    down: false,
  };
  const skip = new Set(skipHeights);
  const timer = setInterval(() => { st.height++; }, blockMs);

  const block = (h) => ({
    header: { height: h, hash: b58(`block${h}`), prev_hash: b58(`block${h - 1}`), timestamp_nanosec: String(BigInt(Date.now()) * 1_000_000n), timestamp: Date.now() * 1e6 },
    chunks: [0, 1].map((shard) => ({ shard_id: shard, chunk_hash: b58(`chunk${h}:${shard}`), height_included: h, tx_root: shard === 0 && st.txsAt.get(h)?.length ? b58(`txroot${h}`) : EMPTY })),
  });

  const err = (name, cause, extra = {}) => ({ error: { name, cause: { name: cause, info: extra }, code: -32000, message: "Server error" } });

  function handle(method, params) {
    st.calls.push(method);
    switch (method) {
      case "status":
        return { result: { chain_id: chainId, sync_info: { latest_block_height: st.height } } };
      case "block": {
        const h = params.block_id ?? st.height;
        if (h > st.height || skip.has(h)) return err("HANDLER_ERROR", "UNKNOWN_BLOCK");
        return { result: block(h) };
      }
      case "chunk": {
        const h = [...st.txsAt.keys()].find((x) => b58(`chunk${x}:0`) === params.chunk_id);
        return { result: { transactions: h === undefined ? [] : st.txsAt.get(h), receipts: [] } };
      }
      case "EXPERIMENTAL_tx_status":
      case "tx": {
        const o = st.outcomes.get(params.tx_hash);
        return o ? { result: o } : err("HANDLER_ERROR", "UNKNOWN_TRANSACTION");
      }
      case "query": {
        if (params.request_type === "call_function") {
          const args = JSON.parse(Buffer.from(params.args_base64, "base64").toString() || "{}");
          let v;
          if (params.method_name === "stats") v = { ...st.stats, claims: st.claims.length };
          else if (params.method_name === "get_claims") v = st.claims.slice(args.from, args.from + args.limit);
          else if (params.method_name === "get_claim") v = st.claims[args.claim_id] ?? null;
          else if (st.views.has(params.method_name)) v = st.views.get(params.method_name)(args, params.account_id);
          else return err("HANDLER_ERROR", "CONTRACT_EXECUTION_ERROR", { vm_error: "MethodNotFound" });
          return { result: { result: [...Buffer.from(JSON.stringify(v))], logs: [], block_height: st.height, block_hash: b58(`block${st.height}`) } };
        }
        if (params.request_type === "view_access_key") {
          const k = st.keys.get(`${params.account_id}|${params.public_key}`);
          return k ? { result: { ...k, block_height: st.height, block_hash: b58(`block${st.height}`) } } : err("HANDLER_ERROR", "UNKNOWN_ACCESS_KEY", { public_key: params.public_key });
        }
        if (params.request_type === "view_account") return { result: { amount: "5000000000000000000000000", locked: "0", storage_usage: 100, ...st.accounts.get(params.account_id) } };
        return err("HANDLER_ERROR", "UNSUPPORTED");
      }
      case "send_tx":
      case "broadcast_tx_async": {
        const b64 = Array.isArray(params) ? params[0] : params.signed_tx_base64;
        const stx = decodeSignedTransaction(Buffer.from(b64, "base64"));
        const t = stx.transaction;
        const signer = t.signerId;
        const txHash = txHashOf(stx);
        if (st.outcomes.has(txHash)) return { result: method === "send_tx" ? st.outcomes.get(txHash) : txHash };
        const admin = st.keys.get(`${signer}|${t.publicKey.toString()}`);
        if (admin && BigInt(t.nonce) <= BigInt(admin.nonce)) return err("HANDLER_ERROR", "INVALID_TRANSACTION", { InvalidNonce: { tx_nonce: String(t.nonce), ak_nonce: String(admin.nonce) } });
        if (admin) admin.nonce = String(t.nonce);
        let failure = null;
        const added = [];
        t.actions.forEach((a, index) => {
          if (failure || !a.addKey) return;
          const pk = `ed25519:${baseEncode(Uint8Array.from(a.addKey.publicKey.ed25519Key.data))}`;
          if (st.keys.has(`${signer}|${pk}`)) { failure = { ActionError: { index, kind: { AddKeyAlreadyExists: { account_id: signer, public_key: pk } } } }; return; }
          const fc = a.addKey.accessKey.permission.functionCall;
          added.push([`${signer}|${pk}`, { nonce: String(st.height * 1_000_000), permission: { FunctionCall: { allowance: fc.allowance.toString(), receiver_id: fc.receiverId, method_names: fc.methodNames } } }]);
        });
        if (!failure) for (const [k, v] of added) st.keys.set(k, v);
        // optional contract behaviour for function calls: st.onCall({ method, args, signer, receiver }) -> { value } | { failure: "panic message" }
        let success = "";
        const fcall = t.actions.find((a) => a.functionCall)?.functionCall;
        if (!failure && fcall && st.onCall) {
          let args = {};
          try { args = JSON.parse(Buffer.from(fcall.args).toString("utf8") || "{}"); } catch { /* raw args */ }
          const r = st.onCall({ method: fcall.methodName, args, signer, receiver: t.receiverId, publicKey: t.publicKey.toString() }) || {};
          if (r.failure) failure = { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${r.failure}` } } } };
          else if (r.value !== undefined) success = Buffer.from(JSON.stringify(r.value)).toString("base64");
        }
        const outcome = { status: failure ? { Failure: failure } : { SuccessValue: success }, transaction: { hash: txHash, signer_id: signer }, transaction_outcome: { id: txHash }, receipts_outcome: [], final_execution_status: "EXECUTED_OPTIMISTIC" };
        st.outcomes.set(txHash, outcome);
        return { result: method === "send_tx" ? outcome : txHash };
      }
      default:
        return err("HANDLER_ERROR", "METHOD_NOT_FOUND");
    }
  }

  const server = http.createServer((req, res) => {
    if (st.down) { req.socket.destroy(); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let j;
      try { j = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
      const r = handle(j.method, j.params);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id, ...r }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    st,
    /** Put a full-access admin key on an account. */
    addAdminKey(accountId, publicKey) {
      st.keys.set(`${accountId}|${publicKey}`, { nonce: "100", permission: "FullAccess" });
    },
    /** Include a transaction in the next block, with these logs from the given executor. */
    injectTx({ hash, signerId, receiverId, actions = [{ FunctionCall: { method_name: "buy", args: "", gas: 1, deposit: "0" } }], logs = [], executorId = receiverId, delayMs = 0 }) {
      const h = st.height + 1;
      if (!st.txsAt.has(h)) st.txsAt.set(h, []);
      st.txsAt.get(h).push({ hash, signer_id: signerId, receiver_id: receiverId, actions, public_key: "ed25519:x", nonce: 1, signature: "ed25519:x" });
      const outcome = { status: { SuccessValue: "" }, transaction: { hash }, receipts_outcome: [{ id: b58(`receipt${hash}`), block_hash: b58(`block${h + 1}`), outcome: { executor_id: executorId, logs, status: { SuccessValue: "" } } }] };
      setTimeout(() => st.outcomes.set(hash, outcome), delayMs);
      return h;
    },
    async close() {
      clearInterval(timer);
      server.closeAllConnections?.();
      await new Promise((r) => server.close(() => r()));
    },
  };
}

function txHashOf(stx) {
  // NEAR's tx hash is sha256 of the borsh-encoded Transaction (without the signature)
  const encoded = Buffer.from(stx.encode());
  const sigLen = 1 + 64; // ed25519 signature: key type byte + 64 bytes
  return baseEncode(createHash("sha256").update(encoded.subarray(0, encoded.length - sigLen)).digest());
}

export function eventLog(event, data) {
  return `EVENT_JSON:${JSON.stringify({ standard: "pricedin", version: "1.0.0", event, data: [data] })}`;
}
