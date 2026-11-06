// The company footer, on every page at every size. NEAR is named here, in the trust line, not on the
// first screen. On the phone it also holds the theme toggle; the desktop header keeps its own.
import Link from "next/link";
import type { ReactNode } from "react";
import { Lockup } from "../Brand";
import { Icon } from "../Icon";
import { ThemeToggle } from "./ThemeToggle";
import { REPLAY_HREF, REPO_URL } from "@/lib/nav";

interface FootLink { href: string; label: ReactNode; name?: string; out?: boolean }

const COLUMNS: { title: string; links: FootLink[] }[] = [
  { title: "Product", links: [
    { href: "/", label: "Facts" },
    { href: "/rulings", label: "Results" },
    { href: "/agents", label: "AI traders" },
    { href: "/portfolio", label: "Portfolio" },
    { href: "/#how", label: "How it works" },
    { href: "/p", label: "Encyclopedia" },
  ] },
  { title: "Proof", links: [
    { href: "/trust", label: "Trust" },
    { href: "/stats", label: "Stats" },
    { href: REPLAY_HREF, label: "Watch a replay" },
    { href: REPO_URL, label: "The code on GitHub", out: true },
    { href: "/trust#rebuild", label: <code>npm run judge</code>, name: "npm run judge" },
  ] },
  { title: "Developers", links: [
    { href: "/developers#api", label: "Truth API" },
    { href: "/developers#mcp", label: "MCP" },
    { href: "/developers#embed", label: "Embed" },
    { href: "/new", label: "Price a claim" },
  ] },
  { title: "Legal", links: [{ href: "/terms", label: "Terms" }] },
];

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-top">
          <div className="foot-brand">
            <Link className="logo" href="/" aria-label="Priced In, home"><Lockup /></Link>
            <p className="foot-line">Is it true? <span>Bet on it.</span></p>
          </div>
          <nav className="foot-cols" aria-label="Footer">
            {COLUMNS.map((c) => (
              <div key={c.title}>
                <h2>{c.title}</h2>
                <ul>
                  {c.links.map((l) => (
                    <li key={l.href}>
                      {l.out
                        ? <a href={l.href} target="_blank" rel="noopener">{l.label}<Icon name="ext" /></a>
                        : <Link href={l.href} aria-label={l.name}>{l.label}</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="foot-base">
          <p className="trust">Runs on NEAR. Paid in USDC.</p>
          <div className="foot-theme"><ThemeToggle /></div>
          <p>© 2026 Priced In.</p>
        </div>
      </div>
    </footer>
  );
}
