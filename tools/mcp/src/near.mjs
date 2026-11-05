// The bet, signed with the caller's own NEAR key from the caller's environment. This file
// never sees any key of ours: Priced In holds none of the caller's, and lends none.

import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";

const TGAS = 10n ** 12n;

const value = (tx) => {
  const v = tx?.status?.SuccessValue;
  if (!v) return undefined;
  const s = Buffer.from(v, "base64").toString("utf8");
  try { return JSON.parse(s); } catch { return s; }
};
const failure = (tx) => tx?.status?.Failure ? JSON.stringify(tx.status.Failure).slice(0, 300) : null;
export const explorer = (network, tx) => `https://${network === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${tx}`;

/**
 * Deposit what the market balance lacks, then buy.
 * @param {{ network: string, rpcUrl: string, accountId: string, privateKey: string }} s
 * @param {{ market: string, usdc: string, claimId: number, side: "yes"|"no", amountMicro: bigint, minSharesMicro: bigint, faucet: boolean }} b
 */
export async function placeBet(s, b) {
  const provider = new JsonRpcProvider({ url: s.rpcUrl });
  let kp;
  try { kp = KeyPair.fromString(s.privateKey); } catch { throw new Error("NEAR_PRIVATE_KEY is not an ed25519:<base58> key"); }
  const account = new Account(s.accountId, provider, new KeyPairSigner(kp));
  const view = (contractId, method, args) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } });
  const call = async (contractId, methodName, args, deposit = 0n, tgas = 30n) => {
    const tx = await account.callFunctionRaw({ contractId, methodName, args, gas: tgas * TGAS, deposit, waitUntil: "EXECUTED_OPTIMISTIC" });
    const f = failure(tx);
    if (f) throw new Error(`${methodName} failed: ${f}`);
    return { tx: tx.transaction?.hash ?? tx.transaction_outcome?.id, value: value(tx) };
  };
  const steps = [];
  const balance = BigInt(await view(b.market, "get_balance", { trader: s.accountId }) ?? 0);
  if (balance < b.amountMicro) {
    const need = b.amountMicro - balance;
    let held = BigInt((await view(b.usdc, "ft_balance_of", { account_id: s.accountId }).catch(() => "0")) ?? 0);
    if (held < need && b.faucet && s.network === "testnet") {
      const f = await call(b.usdc, "faucet", {});
      steps.push({ step: "faucet", tx: f.tx, explorer: explorer(s.network, f.tx), got_micro: String(f.value) });
      held = BigInt(await view(b.usdc, "ft_balance_of", { account_id: s.accountId }));
    }
    if (held < need) throw new Error(`${s.accountId} holds ${Number(held) / 1e6} USDC on ${b.usdc} and has ${Number(balance) / 1e6} on the market; the bet needs ${Number(need) / 1e6} more`);
    const d = await call(b.usdc, "ft_transfer_call", { receiver_id: b.market, amount: need.toString(), msg: "" }, 1n, 100n);
    steps.push({ step: "deposit", tx: d.tx, explorer: explorer(s.network, d.tx), amount_micro: need.toString() });
  }
  const r = await call(b.market, "buy", { claim_id: b.claimId, side: b.side, amount_micro: b.amountMicro.toString(), min_shares_micro: b.minSharesMicro.toString() });
  steps.push({ step: "buy", tx: r.tx, explorer: explorer(s.network, r.tx) });
  return { trade: r.value, tx: r.tx, explorer: explorer(s.network, r.tx), steps };
}
