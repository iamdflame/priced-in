// The go or no-go for scripts/mainnet/dispute.mjs, as one pure function over what the chain said:
// get_challenge, get_claim, dispute_ends_ns, the latest block's time and the signer's balances. Tests:
// services/api/test/dispute-script.test.mjs.

/** The contract's limits (contracts/market/src/lib.rs): MAX_DISPUTES and MAX_EVIDENCE. */
export const MAX_DISPUTES = 3;
export const MAX_EVIDENCE = 4000;

const fmt = (m) => `$${(Number(m) / 1e6).toFixed(2)}`;
const word = (b) => (b ? "TRUE" : "FALSE");

/**
 * The side the signer holds: its own latest bond on this challenge, else the latest bond of the house's
 * other accounts (`house`: the Checker, whose challenge is stake 0, and the Sentinel, which disputes
 * rulings that rest on failed receipts). A string is one house account.
 */
export function heldSide(ch, signer, house = []) {
  const stakes = ch?.stakes || [];
  const latest = (pred) => { const xs = stakes.filter(pred); return xs.length ? xs[xs.length - 1].side : null; };
  const others = (Array.isArray(house) ? house : [house]).filter(Boolean);
  return latest((s) => s.account === signer) ?? latest((s) => others.includes(s.account));
}

/**
 * @param {{ challengeId: number, ch: object|null, claim: object|null, endsNs: string|null, nowNs: bigint|string,
 *   signer: string, house?: string[], checker?: string|null, want?: boolean|null, evidence: string,
 *   balance: bigint, usdc: bigint, depositCap: bigint|null }} o
 * @returns {{ ok: false, why: string } | { ok: true, bond: bigint, current: bigint, ruling: boolean, proposed: boolean, held: boolean|null,
 *   shortfall: bigint, deposit: bigint, round: number, escalates: boolean, endsNs: bigint, leftSecs: number }}
 */
export function disputePlan(o) {
  const { challengeId, ch, claim } = o;
  const no = (why) => ({ ok: false, why });
  if (!ch) return no(`challenge ${challengeId} isn't on the chain (it never existed, or it expired and its record was dropped)`);
  if (!claim) return no(`claim ${ch.claim_id} isn't on the chain`);
  if (ch.resolved || claim.status === "Settled") return no(`challenge ${challengeId} is settled: nothing to dispute`);
  if (claim.status === "Escalated") return no(`challenge ${challengeId} went to the council after ${ch.disputes} disputes`);
  if (claim.status !== "Challenged" || claim.challenge_id !== challengeId) return no(`claim ${ch.claim_id} is ${claim.status} and not under challenge ${challengeId}`);
  if (claim.provisional === null || claim.provisional === undefined) return no("the AI judges haven't reached a provisional ruling yet: there's nothing to dispute");
  if (ch.disputes >= MAX_DISPUTES) return no(`challenge ${challengeId} already has ${ch.disputes} disputes`);
  if (!o.endsNs) return no("the chain gave no dispute window for this challenge");
  const endsNs = BigInt(o.endsNs);
  const nowNs = BigInt(o.nowNs);
  if (nowNs >= endsNs) return no(`the dispute window closed at ${new Date(Number(endsNs / 1_000_000n)).toISOString()}`);
  const evidence = String(o.evidence ?? "");
  const bytes = Buffer.byteLength(evidence, "utf8");
  if (!evidence.trim()) return no("--evidence is required: say why the ruling is wrong, with a source");
  if (bytes > MAX_EVIDENCE) return no(`the evidence is ${bytes} bytes; the contract takes at most ${MAX_EVIDENCE}`);
  const ruling = claim.provisional;
  const proposed = !ruling;
  const held = o.want ?? heldSide(ch, o.signer, o.house ?? o.checker);
  if (held !== null && held === ruling) return no(`the ruling already says ${word(ruling)}, the side ${o.signer} holds: a dispute always flips it, so it would flip it to ${word(proposed)}, against itself`);
  const current = BigInt(ch.bond_micro);
  const bond = current * 2n;
  const shortfall = bond > o.balance ? bond - o.balance : 0n;
  let deposit = 0n;
  if (shortfall > 0n) {
    if (o.depositCap === null || o.depositCap === undefined) return no(`the bond is ${fmt(bond)} and ${o.signer} holds ${fmt(o.balance)} in the market: pass --deposit <USD> to move the ${fmt(shortfall)} shortfall in first`);
    if (shortfall > o.depositCap) return no(`the shortfall is ${fmt(shortfall)}, more than --deposit ${fmt(o.depositCap)}`);
    if (shortfall > o.usdc) return no(`the shortfall is ${fmt(shortfall)} and ${o.signer} holds ${fmt(o.usdc)} USDC: add USDC first`);
    deposit = shortfall;
  }
  const round = ch.disputes + 1;
  return { ok: true, bond, current, ruling, proposed, held, shortfall, deposit, round, escalates: round >= MAX_DISPUTES, endsNs, leftSecs: Number((endsNs - nowNs) / 1_000_000_000n) };
}
