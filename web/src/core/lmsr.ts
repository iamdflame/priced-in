// Client-side LMSR quotes: a line-for-line port of crates/lmsr to BigInt, so a quote in the
// browser is the number the contract will compute, to the last unit (test/vectors/lmsr.json,
// generated from the Rust crate, proves it). Integer division truncates toward zero in both.
// The contract's release build checks i128 overflow, so this port throws LmsrOverflow where
// the contract would panic.
//
// Units: amounts are bigint at SCALE = 1e12 per dollar (or per share). One share pays $1.
// The contract trades whole micro-USDC (1e-6): see contractBuy / contractSell.

export const SCALE = 1_000_000_000_000n;
export const LN2 = 693_147_180_560n;
export const MICRO = 1_000_000n;
const EXP_MAX = 40n * SCALE;
const I128_MAX = (1n << 127n) - 1n;
const I128_MIN = -(1n << 127n);
export const P_MIN = SCALE / 5n;
export const P_MAX = SCALE - SCALE / 5n;
export const D_CAP = 9_210_240_366_976n;
const P_FLOOR = 1_000_000n;

export class LmsrOverflow extends Error {
  constructor() {
    super("arithmetic overflow: the contract would refuse this trade");
    this.name = "LmsrOverflow";
  }
}

function checked(x: bigint): bigint {
  if (x > I128_MAX || x < I128_MIN) throw new LmsrOverflow();
  return x;
}

const abs = (x: bigint) => (x < 0n ? -x : x);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** a * b / SCALE, rounded toward zero. */
export function mul(a: bigint, b: bigint): bigint {
  return checked(a * b) / SCALE;
}

/** a * SCALE / b, rounded toward zero. */
export function div(a: bigint, b: bigint): bigint {
  return checked(a * SCALE) / b;
}

/** e^x at SCALE. Saturates at e^40 and returns 0 below e^-40. */
export function exp(x: bigint): bigint {
  if (x > EXP_MAX) return exp(EXP_MAX);
  if (x < -EXP_MAX) return 0n;
  const k = x >= 0n ? (x + LN2 / 2n) / LN2 : (x - LN2 / 2n) / LN2;
  const r = x - k * LN2;
  let sum = SCALE;
  let term = SCALE;
  for (let n = 1n; n <= 24n; n++) {
    term = checked(term * r) / (n * SCALE);
    if (term === 0n) break;
    sum += term;
  }
  return k >= 0n ? sum << k : sum >> -k;
}

/** e^x - 1 at SCALE, directly for |x| < 1/2. */
export function expm1(x: bigint): bigint {
  if (abs(x) >= SCALE / 2n) return exp(x) - SCALE;
  let sum = 0n;
  let term = x;
  let n = 1n;
  while (term !== 0n && n < 40n) {
    sum += term;
    n += 1n;
    term = checked(term * x) / (n * SCALE);
  }
  return sum;
}

/** ln(x) for x > 0 at SCALE. */
export function ln(x: bigint): bigint {
  if (x <= 0n) throw new RangeError("ln of non-positive");
  let k = 0n;
  let m = x;
  while (m >= 2n * SCALE) { m >>= 1n; k += 1n; }
  while (m < SCALE) { m <<= 1n; k -= 1n; }
  const z = div(m - SCALE, m + SCALE);
  const z2 = mul(z, z);
  let term = z;
  let sum = 0n;
  let n = 1n;
  while (term !== 0n && n < 80n) {
    sum += term / n;
    term = mul(term, z2);
    n += 2n;
  }
  return k * LN2 + 2n * sum;
}

/** ln(1 + e^x), stable for any x. */
export function softplus(x: bigint): bigint {
  const ax = abs(x);
  const pos = x > 0n ? x : 0n;
  return pos + ln(SCALE + exp(-ax));
}

/** 1 / (1 + e^-x) at SCALE. */
export function sigmoid(x: bigint): bigint {
  if (x >= 0n) return div(SCALE, SCALE + exp(-x));
  const e = exp(x);
  return div(e, SCALE + e);
}

export type Side = "yes" | "no";

/** One binary market, exactly the crate's struct. */
export interface Market {
  /** liquidity, dollars at SCALE */
  b: bigint;
  /** opening log-odds at SCALE */
  d0: bigint;
  qYes: bigint;
  qNo: bigint;
}

export function openMarket(b: bigint, p0: bigint): Market {
  if (b <= 0n) throw new RangeError("b must be positive");
  const p = p0 < P_MIN ? P_MIN : p0 > P_MAX ? P_MAX : p0;
  return { b, d0: ln(div(p, SCALE - p)), qYes: 0n, qNo: 0n };
}

const dOf = (m: Market) => m.d0 + div(m.qYes - m.qNo, m.b);

export const priceYes = (m: Market): bigint => sigmoid(dOf(m));
export const priceNo = (m: Market): bigint => SCALE - priceYes(m);
export const priceOf = (m: Market, side: Side): bigint => (side === "yes" ? priceYes(m) : priceNo(m));

/** C(q) at SCALE. */
export const cost = (m: Market): bigint => m.qNo + mul(m.b, softplus(dOf(m)));
export const costOpen = (m: Market): bigint => mul(m.b, softplus(m.d0));

function withShares(m: Market, side: Side, delta: bigint): Market {
  return side === "yes" ? { ...m, qYes: m.qYes + delta } : { ...m, qNo: m.qNo + delta };
}

export const applyBuy = (m: Market, side: Side, shares: bigint): Market => withShares(m, side, shares);
export const applySell = (m: Market, side: Side, shares: bigint): Market => withShares(m, side, -shares);

/** The crate's quote_buy: (shares, charged) with charged <= spend, at SCALE. */
export function quoteBuyRaw(m: Market, side: Side, spend: bigint): [bigint, bigint] {
  if (spend <= 0n) throw new RangeError("spend must be positive");
  const d = dOf(m);
  const room = side === "yes" ? mul(D_CAP - d, m.b) : mul(D_CAP + d, m.b);
  if (room <= 4n) return [0n, 0n];
  const p = max(priceOf(m, side), P_FLOOR);
  const inner = SCALE + div(expm1(div(spend, m.b)), p);
  let shares = mul(m.b, ln(inner));
  if (shares < 0n) shares = 0n;
  if (shares > room) shares = room;
  shares -= 4n;
  const before = cost(m);
  for (;;) {
    if (shares <= 0n) return [0n, 0n];
    const after = withShares(m, side, shares);
    const charged = cost(after) - before + 1n;
    if (charged <= spend) return [shares, charged];
    const pAfter = max(priceOf(after, side), P_FLOOR);
    shares -= div(charged - spend, pAfter) + 1n;
  }
}

/** The crate's quote_sell: proceeds rounded down, at SCALE. */
export function quoteSellRaw(m: Market, side: Side, shares: bigint): bigint {
  if (shares <= 0n) throw new RangeError("shares must be positive");
  const held = side === "yes" ? m.qYes : m.qNo;
  if (shares > held) throw new RangeError("cannot sell more than outstanding");
  const proceeds = cost(m) - cost(withShares(m, side, -shares)) - 1n;
  return proceeds < 0n ? 0n : proceeds;
}

export function maxLoss(m: Market, side: Side): bigint {
  const p0 = sigmoid(m.d0);
  return mul(m.b, -ln(side === "yes" ? p0 : SCALE - p0));
}

/** The contract's buy in whole micro-USDC: shares floored to micro, charged the exact cost rounded up. */
export function contractBuy(m: Market, side: Side, amountMicro: bigint): { sharesMicro: bigint; chargedMicro: bigint; after: Market } {
  const [shares] = quoteBuyRaw(m, side, amountMicro * MICRO);
  const sharesMicro = shares / MICRO;
  if (sharesMicro <= 0n) return { sharesMicro: 0n, chargedMicro: 0n, after: m };
  const after = applyBuy(m, side, sharesMicro * MICRO);
  const exact = cost(after) - cost(m);
  const chargedMicro = (max(exact, 0n) + MICRO - 1n) / MICRO;
  return { sharesMicro, chargedMicro, after };
}

/** The contract's sell of whole-micro shares: proceeds floored to micro. */
export function contractSell(m: Market, side: Side, sharesMicro: bigint): { proceedsMicro: bigint; after: Market } {
  const proceeds = quoteSellRaw(m, side, sharesMicro * MICRO);
  return { proceedsMicro: max(proceeds, 0n) / MICRO, after: applySell(m, side, sharesMicro * MICRO) };
}

/** The contract's cost_to_move view: micro-USDC to push YES up (or down) 10 points; 0 near the edges. */
export function costToMoveMicro(m: Market, up: boolean): bigint {
  const p = priceYes(m);
  const target = up ? p + SCALE / 10n : p - SCALE / 10n;
  const edge = SCALE / 1000n;
  if (target <= edge || target >= SCALE - edge) return 0n;
  const dTarget = ln(div(target, SCALE - target));
  const delta = mul(dTarget - dOf(m), m.b);
  const after = delta > 0n ? applyBuy(m, "yes", delta) : applyBuy(m, "no", -delta);
  return max(cost(after) - cost(m), 0n) / MICRO;
}

// ---------- the numbers the views use ----------

const toNum = (x: bigint) => Number(x) / 1e12;

/** A market equivalent to a claim view: the same price and liquidity, so quotes match the chain's. */
export function marketFromPrice(priceYesPpm: number, bMicro: bigint | number | string): Market {
  const ppm = BigInt(Math.min(999_900, Math.max(100, Math.round(priceYesPpm))));
  const p = ppm * MICRO;
  return { b: BigInt(bMicro) * MICRO, d0: ln(div(p, SCALE - p)), qYes: 0n, qNo: 0n };
}

/** A fresh market from a planner receipt (p0_ppm, b_micro): exactly what open_and_buy opens. */
export const marketFromReceipt = (p0Ppm: number, bMicro: bigint | number | string): Market =>
  openMarket(BigInt(bMicro) * MICRO, BigInt(p0Ppm) * MICRO);

/**
 * The liquidity implied by a claim view's cost-to-move figures, in whole micro-USDC
 * (the contract's ClaimView has no b). Buying YES from p to p + 0.1 costs b ln((1 - p) / (0.9 - p)).
 */
export function impliedBMicro(priceYes: number, upMicro: number, downMicro: number): number | null {
  let est: number | null = null;
  if (upMicro > 0 && priceYes + 0.1 < 0.999) est = upMicro / Math.log((1 - priceYes) / (1 - priceYes - 0.1));
  else if (downMicro > 0 && priceYes - 0.1 > 0.001) est = downMicro / Math.log(priceYes / (priceYes - 0.1));
  if (est === null || !Number.isFinite(est) || est <= 0) return null;
  // the view's figures are rounded to whole micro-USDC; liquidity is set in round amounts
  const round = Math.round(est / 1000) * 1000;
  return Math.abs(round - est) / est < 1e-4 ? round : Math.round(est);
}

export interface BuyQuote {
  side: Side;
  amountMicro: bigint;
  sharesMicro: bigint;
  chargedMicro: bigint;
  /** dollars */
  shares: number;
  cost: number;
  avgPrice: number;
  priceBefore: number;
  priceAfter: number;
  after: Market;
  /** the spend is larger than this market can quote (the contract would refuse it) */
  overflow: boolean;
  /** nothing to buy: the price is at its cap */
  capped: boolean;
}

/** What `amountUsd` buys on `side`, exactly as the contract will fill it. */
export function quoteBuy(m: Market, side: Side, amountUsd: number): BuyQuote {
  const amountMicro = BigInt(Math.round(amountUsd * 1e6));
  const before = toNum(priceYes(m));
  const base = { side, amountMicro, priceBefore: before };
  if (amountMicro <= 0n) return { ...base, sharesMicro: 0n, chargedMicro: 0n, shares: 0, cost: 0, avgPrice: 0, priceAfter: before, after: m, overflow: false, capped: false };
  try {
    const r = contractBuy(m, side, amountMicro);
    const shares = Number(r.sharesMicro) / 1e6;
    const c = Number(r.chargedMicro) / 1e6;
    return { ...base, sharesMicro: r.sharesMicro, chargedMicro: r.chargedMicro, shares, cost: c, avgPrice: shares > 0 ? c / shares : 0, priceAfter: toNum(priceYes(r.after)), after: r.after, overflow: false, capped: r.sharesMicro === 0n };
  } catch (e) {
    if (!(e instanceof LmsrOverflow)) throw e;
    return { ...base, sharesMicro: 0n, chargedMicro: 0n, shares: 0, cost: 0, avgPrice: 0, priceAfter: before, after: m, overflow: true, capped: false };
  }
}

export interface SellQuote {
  side: Side;
  sharesMicro: bigint;
  proceedsMicro: bigint;
  proceeds: number;
  priceBefore: number;
  priceAfter: number;
  after: Market;
}

/**
 * Selling whole-micro shares. On a market rebuilt from a price (marketFromPrice) the outstanding
 * shares are unknown, so the position is credited to the market first: selling it back moves
 * the price the way the chain does, whatever the history.
 */
export function quoteSell(m: Market, side: Side, sharesMicro: bigint): SellQuote {
  const held = side === "yes" ? m.qYes : m.qNo;
  const mm = held >= sharesMicro * MICRO ? m : withShares({ ...m, d0: m.d0 - (side === "yes" ? div(sharesMicro * MICRO, m.b) : -div(sharesMicro * MICRO, m.b)) }, side, sharesMicro * MICRO);
  const r = contractSell(mm, side, sharesMicro);
  return { side, sharesMicro, proceedsMicro: r.proceedsMicro, proceeds: Number(r.proceedsMicro) / 1e6, priceBefore: toNum(priceYes(mm)), priceAfter: toNum(priceYes(r.after)), after: r.after };
}

/** What moving the price `points` costs, in dollars, up and down. 10 points matches the contract's view exactly. */
export function costToMove(m: Market, points = 10): { upUsd: number; downUsd: number } {
  if (points === 10) return { upUsd: Number(costToMoveMicro(m, true)) / 1e6, downUsd: Number(costToMoveMicro(m, false)) / 1e6 };
  const p = toNum(priceYes(m));
  const b = toNum(m.b);
  const t = points / 100;
  const up = p + t < 0.999 ? b * Math.log((1 - p) / (1 - p - t)) : 0;
  const down = p - t > 0.001 ? b * Math.log(p / (p - t)) : 0;
  return { upUsd: up, downUsd: down };
}

/** Price as a 0..1 number. */
export const priceNumber = (m: Market): number => toNum(priceYes(m));
