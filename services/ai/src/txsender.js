// Function calls from one account and key, one transaction at a time (so nonces never race),
// sent the way the API's lane is: a synchronous send raced against async broadcasts and
// status polls (services/api/src/rpc.mjs sendTxRace). Used by the agents' signer process and
// by the jury runner.

import { KeyPairSigner, actions, createTransaction, baseDecode, baseEncode } from "near-api-js";

const TGAS = 10n ** 12n;

export class TxFailure extends Error {
  constructor(message, { txHash, failure } = {}) {
    super(message);
    this.txHash = txHash;
    this.failure = failure;
  }
}

/** The panic message of a failed function call, or the failure as JSON. */
export function failureMessage(failure) {
  const ex = failure?.ActionError?.kind?.FunctionCallError?.ExecutionError;
  if (ex) return ex;
  return JSON.stringify(failure).slice(0, 400);
}

export class FunctionCallSender {
  /**
   * @param {{ rpc: import('../../api/src/rpc.mjs').Rpc, accountId: string, keyPair: import('near-api-js').KeyPair, receiverId: string, deadlineMs?: number }} o
   */
  constructor({ rpc, accountId, keyPair, receiverId, deadlineMs = 20000 }) {
    this.rpc = rpc;
    this.accountId = accountId;
    this.keyPair = keyPair;
    this.signer = new KeyPairSigner(keyPair);
    this.publicKey = keyPair.getPublicKey().toString();
    this.receiverId = receiverId;
    this.deadlineMs = deadlineMs;
    this.nonce = null;
    this.hash = null;
    this.hashAt = 0;
    this.chain = Promise.resolve();
  }

  async accessKey() {
    return this.rpc.viewAccessKey(this.accountId, this.publicKey, "optimistic");
  }

  async blockHash() {
    if (this.hash && Date.now() - this.hashAt < 60_000) return this.hash;
    const b = await this.rpc.block("final");
    this.hash = b.header.hash;
    this.hashAt = Date.now();
    return this.hash;
  }

  /** Call a method; resolves with { txHash, value } (value: the JSON return, or null). */
  call(methodName, args, { gasTgas = 30 } = {}) {
    const run = this.chain.then(() => this.send(methodName, args, gasTgas));
    this.chain = run.catch(() => {});
    return run;
  }

  async send(methodName, args, gasTgas) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.nonce === null) this.nonce = BigInt((await this.accessKey()).nonce);
      const nonce = ++this.nonce;
      const tx = createTransaction(this.accountId, this.keyPair.getPublicKey(), this.receiverId, nonce, [actions.functionCall(methodName, args, BigInt(gasTgas) * TGAS, 0n)], baseDecode(await this.blockHash()));
      const { txHash, signedTransaction } = await this.signer.signTransaction(tx);
      const hash = baseEncode(txHash);
      let outcome;
      try {
        outcome = await this.rpc.sendTxRace(Buffer.from(signedTransaction.encode()).toString("base64"), hash, this.accountId, { deadlineMs: this.deadlineMs });
      } catch (e) {
        const msg = `${e.message} ${JSON.stringify(e.data || "")}`;
        if (/InvalidNonce|nonce/i.test(msg)) { this.nonce = null; continue; }
        if (/Expired|InvalidChain|block hash/i.test(msg)) { this.hash = null; continue; }
        this.nonce = null;
        throw e;
      }
      const failure = outcome.status?.Failure;
      if (failure) throw new TxFailure(failureMessage(failure), { txHash: hash, failure });
      const b64 = outcome.status?.SuccessValue;
      let value = null;
      if (b64) { try { value = JSON.parse(Buffer.from(b64, "base64").toString("utf8")); } catch { value = null; } }
      return { txHash: hash, value };
    }
    throw new Error("could not send the transaction after 3 attempts (nonce or block hash kept changing)");
  }
}
