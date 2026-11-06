// Amounts, in one place. Money is a bigint of micro-USDC (or base units) from the moment a person types
// it: decimal strings are parsed exactly, never through a float.

const USDC_DECIMALS = 6;

/** Base units from a decimal string ("12.5" at 6 decimals is 12500000n). Null if it isn't a positive amount that fits. */
export function toUnits(amount: string, decimals: number): bigint | null {
  const s = amount.trim();
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) return null;
  const v = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
  return v > 0n ? v : null;
}

export const parseUsd = (s: string) => toUnits(s, USDC_DECIMALS);

/** The exact decimal string for an amount field: 12500000n is "12.5". */
export function microToInput(m: bigint): string {
  const whole = m / 1_000_000n;
  const frac = (m % 1_000_000n).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Whole cents, as text, from a count of cents. */
const cents = (c: bigint) => `$${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;

/** $1.81, rounded down to the cent: for what the chain will pay, so we never promise more. */
export const fmtMicroDown = (m: bigint) => cents(m / 10_000n);

/** $1.81, to the nearest cent: for amounts that already moved. */
export const fmtMicro = (m: bigint) => cents((m + 5_000n) / 10_000n);

/** 1.81 shares from micro-shares, rounded down. */
export const fmtShares = (m: bigint) => fmtMicroDown(m).slice(1);
