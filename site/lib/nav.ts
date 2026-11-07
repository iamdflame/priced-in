// The main navigation, in one place. A stream that adds a route adds it here (and to the phone bar
// with `phone: true`, at most four there).
import type { IconName } from "@/components/Icon";

export interface NavItem { href: string; label: string; icon: IconName; phone?: boolean; match?: (path: string) => boolean }

export const NAV: NavItem[] = [
  { href: "/", label: "Facts", icon: "pulse", phone: true, match: (p) => p === "/" || p.startsWith("/c/") },
  { href: "/rulings", label: "Results", icon: "gavel", phone: true },
  { href: "/agents", label: "AI traders", icon: "bot", phone: true },
  { href: "/portfolio", label: "Portfolio", icon: "wallet", phone: true },
  { href: "/how", label: "How it works", icon: "info" },
];

/**
 * With today's news on (the API answers /api/today), the leaderboard takes the AI traders' place in the
 * header and the phone bar: it sets people and the three AI traders side by side, and links each AI to
 * its page. With it off, the list is NAV as it was: no link to a page that would 404.
 */
export const NEWS_NAV: NavItem[] = [
  NAV[0],
  { href: "/leaderboard", label: "Leaderboard", icon: "board", phone: true },
  NAV[1],
  NAV[3],
  NAV[4],
];

export const navFor = (news: boolean) => (news ? NEWS_NAV : NAV);

/** The replay of the complete mainnet run: every "watch a replay" link goes here. */
export const REPLAY_HREF = "/c/18?recorded=1";

export const SITE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://isitpriced.com").replace(/\/+$/, "");
export const MARKET_ID = "market.isitpriced.near";
export const REPO_URL = "https://github.com/iamdflame/priced-in";
