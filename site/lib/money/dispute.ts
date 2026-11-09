// Objecting to an AI ruling, as plain rules. While a ruling's window is open, anyone with a real NEAR
// account (never the free-bet lane) can post twice the current bond with a reason. That flips the
// proposed outcome and restarts the window; the third objection sends it to the council. At the end
// the losing side's bonds pay the winning side (contracts/market/src/lib.rs, dispute and resolve).
// Each check returns null when the objection may go ahead, or the sentence that says why not.
import type { ChallengeView, ClaimView } from "./chain";
import type { MoneyConfig } from "./config";
import { canAddMoney, type Access } from "./geo";
import type { Refusal } from "./rules";
import { depositTx, disputeTx, type TxSpec } from "./tx";
import { fmtMicro } from "./units";

/** The objection that sends a ruling to the council (MAX_DISPUTES in the contract). */
export const MAX_DISPUTES = 3;
/** The contract's limit on a reason, in bytes (MAX_EVIDENCE). */
export const MAX_EVIDENCE_BYTES = 4000;

export const evidenceBytes = (s: string) => new TextEncoder().encode(s.trim()).length;

export function evidenceProblem(s: string): Refusal {
  if (!s.trim()) return "Say why the ruling is wrong, with a link to your source.";
  const n = evidenceBytes(s);
  if (n > MAX_EVIDENCE_BYTES) return `That’s ${n.toLocaleString("en-US")} bytes; the limit is 4,000. Shorten it.`;
  return null;
}

/** A free-bet key signs through the lane account; the market refuses it an objection, so it never sees the button. */
export const isLaneAccount = (accountId: string | null | undefined, laneAccount: string) => !!accountId && (accountId.startsWith("lane:") || accountId === laneAccount);

/** The ruling as the page knows it: from /api/rulings, or the chain's own views once read. */
export interface WindowFacts { status: string; windowEndsAt: number | null; disputes: number }

/** Open: a provisional ruling, its window still running, and fewer than three objections. */
export const windowOpen = (r: WindowFacts, now: number) => r.status === "window" && r.windowEndsAt !== null && now < r.windowEndsAt && r.disputes < MAX_DISPUTES;

/** The same facts from the chain: get_challenge, get_claim and dispute_ends_ns, read together. */
export function liveWindow(challengeId: number, ch: ChallengeView | null, claim: ClaimView | null, endsMs: number | null): WindowFacts {
  const running = !!ch && !ch.resolved && !!claim && claim.status === "Challenged" && claim.challenge_id === challengeId && claim.provisional !== null && claim.provisional !== undefined;
  return { status: running ? "window" : claim?.status === "Escalated" ? "escalated" : "closed", windowEndsAt: running ? endsMs : null, disputes: ch?.disputes ?? 0 };
}

export type Gate = "hidden" | "connect" | "ready";

/**
 * Whether the ruling shows "Object to this ruling", and what a tap does. Hidden when the window is
 * closed, from a region where money can't go in, and for the free-bet lane; "connect" asks for a wallet.
 */
export function objectGate(r: WindowFacts, now: number, wallet: { status: string; accountId: string | null }, access: Access, laneAccount: string): Gate {
  if (!windowOpen(r, now)) return "hidden";
  if (!canAddMoney(access)) return "hidden";
  if (isLaneAccount(wallet.accountId, laneAccount)) return "hidden";
  return wallet.status === "in" && wallet.accountId ? "ready" : "connect";
}

/** What an objection posts: twice the current bond (get_challenge's bond_micro). */
export const disputeBond = (ch: Pick<ChallengeView, "bond_micro">) => BigInt(ch.bond_micro) * 2n;

/** The side the account's own latest bond is on, if it posted one. */
export function ownSide(ch: Pick<ChallengeView, "stakes">, accountId: string | null): boolean | null {
  if (!accountId) return null;
  const mine = ch.stakes.filter((s) => s.account === accountId);
  return mine.length ? mine[mine.length - 1].side : null;
}

/** How the bond gets paid: from the balance, or with the shortfall moved in from the wallet's USDC first. */
export interface Funding { shortfall: bigint; depositMicro: bigint | null; needsDeposit: boolean }
export function funding(bond: bigint, balance: bigint | null, walletUsdc: bigint | null): Funding {
  const shortfall = balance === null ? 0n : bond > balance ? bond - balance : 0n;
  if (shortfall === 0n) return { shortfall, depositMicro: null, needsDeposit: false };
  if (walletUsdc !== null && walletUsdc >= shortfall) return { shortfall, depositMicro: shortfall, needsDeposit: false };
  return { shortfall, depositMicro: null, needsDeposit: true };
}

export interface DisputeCheck {
  access: Access;
  window: WindowFacts;
  now: number;
  accountId: string | null;
  laneAccount: string;
  evidence: string;
  bond: bigint;
  /** the ruling now: an objection flips it */
  provisional: boolean | null;
  /** the side of the account's own latest bond on this challenge */
  mine: boolean | null;
  balance: bigint | null;
  walletUsdc: bigint | null;
}

export function checkDispute(o: DisputeCheck): Refusal {
  if (!canAddMoney(o.access)) return "Objections put money in, and that isn’t available from your region.";
  if (!windowOpen(o.window, o.now)) return o.window.status === "escalated" ? "Three objections were filed, so the market’s council decides this one." : "The window for objections has closed.";
  if (!o.accountId) return "Connect a NEAR wallet to object.";
  if (isLaneAccount(o.accountId, o.laneAccount)) return "The free $1 can’t object. Connect a NEAR wallet.";
  if (o.provisional === null) return "The AI judges haven’t ruled yet, so there’s nothing to object to.";
  if (o.mine !== null && o.mine === o.provisional) return `Your bond already backs the ruling (${o.provisional ? "true" : "false"}). Objecting would flip it against you.`;
  const bad = evidenceProblem(o.evidence);
  if (bad) return bad;
  if (o.balance === null) return "Reading your balance from NEAR…";
  const f = funding(o.bond, o.balance, o.walletUsdc);
  if (f.needsDeposit) return `The bond is ${fmtMicro(o.bond)} and your balance is ${fmtMicro(o.balance)}. Deposit ${fmtMicro(f.shortfall)} first.`;
  return null;
}

/** What the wallet signs: the shortfall moved in from the wallet's USDC when needed, then the objection. */
export function disputeTxs(c: MoneyConfig, challengeId: number, evidence: string, bond: bigint, provisional: boolean, f: Funding): TxSpec[] {
  const txs: TxSpec[] = [];
  if (f.depositMicro) txs.push(depositTx(c, f.depositMicro));
  txs.push(disputeTx(c, challengeId, evidence.trim(), bond, !provisional));
  return txs;
}
