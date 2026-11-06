// The transactions a wallet signs, as plain data, each with the one sentence the person reads before
// approving it. Pure functions: the wallet layer turns them into NEAR actions, the tests read them as
// they are, and the mock wallet in the e2e tests receives exactly this.
import { GAS, ONE_YOCTO, USDC_STORAGE_YOCTO, fmtMicro, fmtShares, type MoneyConfig } from "./config";

export interface CallSpec { method: string; args: Record<string, unknown>; gasTgas: string; depositYocto: string }
export interface TxSpec { receiverId: string; actions: CallSpec[]; says: string }
export type Side = "yes" | "no";

const call = (method: string, args: Record<string, unknown>, gasTgas: bigint, depositYocto = 0n): CallSpec =>
  ({ method, args, gasTgas: gasTgas.toString(), depositYocto: depositYocto.toString() });

const sideWord = (s: Side) => (s === "yes" ? "Yes (it’s true)" : "No (it’s false)");
const short = (a: string) => (a.length > 24 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

/** USDC already in the wallet into the market balance: the token calls the market's ft_on_transfer. */
export function depositTx(c: MoneyConfig, amountMicro: bigint): TxSpec {
  if (amountMicro <= 0n) throw new Error("deposit amount must be positive");
  return {
    receiverId: c.usdc,
    actions: [call("ft_transfer_call", { receiver_id: c.market, amount: amountMicro.toString(), msg: "" }, GAS.depositCall, ONE_YOCTO)],
    says: `Move ${fmtMicro(amountMicro)} USDC from your wallet into your Priced In balance.`,
  };
}

/** Buy with the market balance. min_shares_micro is the slippage floor: fewer shares and the chain refuses. */
export function buyTx(c: MoneyConfig, claimId: number, side: Side, amountMicro: bigint, minSharesMicro: bigint): TxSpec {
  if (amountMicro <= 0n) throw new Error("bet amount must be positive");
  return {
    receiverId: c.market,
    actions: [call("buy", { claim_id: claimId, side, amount_micro: amountMicro.toString(), min_shares_micro: minSharesMicro.toString() }, GAS.buy)],
    says: `Bet ${fmtMicro(amountMicro)} of your balance on ${sideWord(side)}, for at least ${fmtShares(minSharesMicro)} shares, or nothing happens.`,
  };
}

/** Sell shares back to the market. min_proceeds_micro is the floor on what reaches the balance, after the fee. */
export function sellTx(c: MoneyConfig, claimId: number, side: Side, sharesMicro: bigint, minProceedsMicro: bigint): TxSpec {
  if (sharesMicro <= 0n) throw new Error("shares must be positive");
  return {
    receiverId: c.market,
    actions: [call("sell", { claim_id: claimId, side, shares_micro: sharesMicro.toString(), min_proceeds_micro: minProceedsMicro.toString() }, GAS.sell)],
    says: `Sell ${fmtShares(sharesMicro)} ${side === "yes" ? "Yes" : "No"} shares for at least ${fmtMicro(minProceedsMicro)}, paid into your balance.`,
  };
}

/** Collect a settled market's winnings: $1 a winning share, into the balance. */
export function redeemTx(c: MoneyConfig, claimId: number, winMicro: bigint | null): TxSpec {
  return {
    receiverId: c.market,
    actions: [call("redeem", { claim_id: claimId }, GAS.redeem)],
    says: winMicro !== null ? `Collect ${fmtMicro(winMicro)} of winnings into your Priced In balance.` : "Collect your winnings into your Priced In balance.",
  };
}

/** Register an account on the USDC contract so it can receive USDC (0.00125 NEAR, once). */
export function storageTx(c: MoneyConfig, accountId: string): TxSpec {
  return {
    receiverId: c.usdc,
    actions: [call("storage_deposit", { account_id: accountId, registration_only: true }, GAS.storage, USDC_STORAGE_YOCTO)],
    says: `Let ${short(accountId)} receive USDC on NEAR (a one-time 0.00125 NEAR storage fee).`,
  };
}

/** The market balance out, as USDC, to the signer's own NEAR account. */
export function withdrawTx(c: MoneyConfig, amountMicro: bigint): TxSpec {
  if (amountMicro <= 0n) throw new Error("withdraw amount must be positive");
  return {
    receiverId: c.market,
    actions: [call("withdraw", { amount_micro: amountMicro.toString() }, GAS.withdraw)],
    says: `Withdraw ${fmtMicro(amountMicro)} from your Priced In balance to your NEAR wallet, as USDC.`,
  };
}

/**
 * Out to another chain through NEAR Intents 1Click: the balance to the wallet (when it comes from the
 * balance), then the USDC to the quote's one-time deposit address on NEAR (registered first if it is
 * new), which 1Click swaps and delivers to the address on the other chain.
 */
export function bridgeOutTxs(c: MoneyConfig, o: { amountMicro: bigint; depositAddress: string; needsStorage: boolean; fromBalance: boolean; destination: string }): TxSpec[] {
  if (o.amountMicro <= 0n) throw new Error("amount must be positive");
  const out: TxSpec[] = [];
  if (o.fromBalance) out.push(withdrawTx(c, o.amountMicro));
  const actions: CallSpec[] = [];
  if (o.needsStorage) actions.push(call("storage_deposit", { account_id: o.depositAddress, registration_only: true }, GAS.storage, USDC_STORAGE_YOCTO));
  actions.push(call("ft_transfer", { receiver_id: o.depositAddress, amount: o.amountMicro.toString() }, GAS.transfer, ONE_YOCTO));
  out.push({ receiverId: c.usdc, actions, says: `Send ${fmtMicro(o.amountMicro)} USDC to NEAR Intents, which delivers it to ${o.destination}.` });
  return out;
}

/** One line for a set of transactions: what the person approves, in order. */
export const approvalSentence = (txs: TxSpec[]) => txs.map((t) => t.says).join(" Then: ");
