// The geofence's one rule, shared by proxy.ts (which reads Vercel's x-vercel-ip-country and
// x-vercel-ip-country-region headers) and the money screens (which read the cookie the proxy sets).
// The list itself is data/restricted-regions.json, with its sources.
import list from "../../data/restricted-regions.json";

export type Access = "open" | "close_only" | "blocked" | "unknown";

export const GEO_COOKIE = "pi_geo";
export const LIMITS = { maxBetUsd: list.limits.max_bet_usd, maxDepositUsd: list.limits.max_deposit_usd };
export const REGIONS = list;

const norm = (s: string | null | undefined) => (s || "").trim().toUpperCase();

/**
 * What real money may do from a country (ISO 3166-1 alpha-2) and region (the subdivision code without
 * the country, as Vercel sends it: "ON" for Ontario). No country is "unknown", which is open on a local
 * run. Where the header is required (on Vercel, which always sends it) the geofence fails closed: an
 * address it can't place may take money out but not put new money in.
 */
export function accessFor(country: string | null | undefined, region?: string | null, o: { required?: boolean } = {}): Access {
  const c = norm(country);
  if (!c || c === "XX") return o.required ? "close_only" : "unknown";
  const r = norm(region);
  const sub = r ? (r.includes("-") ? r : `${c}-${r}`) : "";
  if (list.blocked.countries.includes(c) || (sub && list.blocked.regions.includes(sub))) return "blocked";
  if (list.close_only.countries.includes(c) || (sub && list.close_only.regions.includes(sub))) return "close_only";
  return "open";
}

/** Can money go in (deposit, a new bet) or out (sell, collect, withdraw) from here? */
export const canAddMoney = (a: Access) => a === "open" || a === "unknown";
export const canTakeOut = (a: Access) => a !== "blocked";

/** The cookie value: access and country, e.g. "close_only.US". */
export const encodeGeo = (a: Access, country: string | null | undefined) => `${a}.${norm(country) || "XX"}`;
export function decodeGeo(v: string | null | undefined): { access: Access; country: string | null } {
  const [a, c] = String(v || "").split(".");
  const access = (["open", "close_only", "blocked", "unknown"] as Access[]).includes(a as Access) ? (a as Access) : "unknown";
  return { access, country: c && c !== "XX" ? c : null };
}

const NAMES: Record<string, string> = { US: "the United States", GB: "the United Kingdom", FR: "France", DE: "Germany", AU: "Australia", SG: "Singapore", CA: "Canada", IT: "Italy", PL: "Poland", BR: "Brazil", TW: "Taiwan", TH: "Thailand", BE: "Belgium", NZ: "New Zealand", RU: "Russia", AR: "Argentina" };
export const placeName = (country: string | null) => (country ? NAMES[country] ?? country : "your region");

/** The one-line notice, said wherever real money moves. */
export function geoLine(a: Access, country: string | null): string | null {
  if (a === "blocked") return `Real money isn’t available from ${placeName(country)}. Your free $1 still works, as score.`;
  if (a === "close_only") return `From ${placeName(country)} you can sell, collect and withdraw, but not deposit or place new real-money bets. Your free $1 still works, as score.`;
  return null;
}
