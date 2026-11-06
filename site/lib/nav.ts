// The main navigation, in one place. A stream that adds a route adds it here (and to the phone bar
// with `phone: true`, at most four there).
import type { IconName } from "@/components/Icon";

export interface NavItem { href: string; label: string; icon: IconName; phone?: boolean; match?: (path: string) => boolean }

export const NAV: NavItem[] = [
  { href: "/", label: "Facts", icon: "pulse", phone: true, match: (p) => p === "/" || p.startsWith("/c/") },
  { href: "/#deciding", label: "Being decided", icon: "clock", phone: true },
  { href: "/#results", label: "Results", icon: "gavel", phone: true },
  { href: "/#how", label: "How it works", icon: "info", phone: true },
];

export const SITE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://isitpriced.com").replace(/\/+$/, "");
export const MARKET_ID = "market.isitpriced.near";
export const REPO_URL = "https://github.com/iamdflame/priced-in";
