// The company footer, on every page at every size, built to the standard of the big prediction markets:
// the brand, every topic with a live market (its real count of facts), three dense link groups, a base bar
// with the real accounts only (GitHub, npm, the contract), the legal line and the theme, then the fine print.
// On a phone the topics are a two-column list and each link group is a details/summary accordion.
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Lockup } from "../Brand";
import { Icon } from "../Icon";
import { ThemeToggle } from "./ThemeToggle";
import { plural } from "@/lib/format";
import { MARKET_ID, REPLAY_HREF, REPO_URL } from "@/lib/nav";
import { getSite } from "@/lib/server/site";

const NPM_URL = "https://www.npmjs.com/package/pricedin-mcp";
const CONTRACT_URL = `https://nearblocks.io/address/${MARKET_ID}`;

interface FootLink { href: string; label: ReactNode; out?: boolean }

const GROUPS: { title: string; links: FootLink[] }[] = [
  { title: "Product", links: [
    { href: "/", label: "Facts" },
    { href: "/rulings", label: "Results" },
    { href: "/agents", label: "AI traders" },
    { href: "/portfolio", label: "Portfolio" },
    { href: "/new", label: "Price a claim" },
    { href: "/p", label: "Encyclopedia" },
  ] },
  { title: "Help & proof", links: [
    { href: "/how", label: "How it works" },
    { href: "/help", label: "Help center" },
    { href: "/status", label: "Status" },
    { href: "/trust", label: "Trust" },
    { href: "/accuracy", label: "Accuracy" },
    { href: REPLAY_HREF, label: "Watch a replay" },
  ] },
  { title: "Developers", links: [
    { href: "/developers#api", label: "Truth API" },
    { href: "/developers#mcp", label: "MCP" },
    { href: "/developers#embed", label: "Embed" },
    { href: NPM_URL, label: "The npm package", out: true },
    { href: REPO_URL, label: "Source code", out: true },
  ] },
];

/** The Wikipedia pages with live markets, biggest first. The count comes from the same data /p uses. */
const TOPICS: { slug: string; label: string }[] = [
  { slug: "tether", label: "Tether" },
  { slug: "prediction-market", label: "Prediction market" },
  { slug: "polymarket", label: "Polymarket" },
  { slug: "ethereum", label: "Ethereum" },
  { slug: "bitcoin", label: "Bitcoin" },
  { slug: "near", label: "NEAR" },
  { slug: "stablecoin", label: "Stablecoin" },
  { slug: "uniswap", label: "Uniswap" },
  { slug: "dai", label: "Dai" },
  { slug: "defi", label: "DeFi" },
];

function FootA({ l }: { l: FootLink }) {
  return l.out
    ? <a href={l.href} target="_blank" rel="noopener">{l.label}<Icon name="ext" /></a>
    : <Link href={l.href} prefetch={false}>{l.label}</Link>;
}

function TopicList({ counts }: { counts: Map<string, number> | null }) {
  const shown = counts ? TOPICS.filter((t) => (counts.get(t.slug) ?? 0) > 0) : TOPICS;
  return (
    <ul className="ft-topics">
      {shown.map((t) => (
        <li key={t.slug}>
          <Link href={`/p/${t.slug}`} prefetch={false}>
            <b>{t.label}</b>
            <span>{counts ? `${plural(counts.get(t.slug) ?? 0, "fact")} & odds` : "Facts & odds"}</span>
          </Link>
        </li>
      ))}
      <li className="ft-all"><Link href="/p" prefetch={false}><b>All topics</b><span>The encyclopedia, priced</span></Link></li>
    </ul>
  );
}

/** The counts read the market on their own, so a slow API never holds up the page. */
async function Topics() {
  const site = await getSite();
  if (!site.ok) return <TopicList counts={null} />;
  const counts = new Map<string, number>();
  for (const f of site.facts) if (f.page) counts.set(f.page, (counts.get(f.page) ?? 0) + 1);
  return <TopicList counts={counts} />;
}

const GITHUB = "M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .32.21.69.82.57A12 12 0 0 0 12 .3";
const NPM = "M1.76 0A1.76 1.76 0 0 0 0 1.76v20.48C0 23.21.79 24 1.76 24h20.48c.97 0 1.76-.79 1.76-1.76V1.76C24 .79 23.21 0 22.24 0zm3.37 5.32 13.84.02-.01 13.84h-3.46l.01-10.38h-3.46l-.01 10.38H5.11z";

function Social() {
  return (
    <ul className="ft-social" aria-label="Priced In elsewhere">
      <li><a href={REPO_URL} target="_blank" rel="noopener" aria-label="Source code on GitHub"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={GITHUB} /></svg></a></li>
      <li><a href={NPM_URL} target="_blank" rel="noopener" aria-label="pricedin-mcp on npm"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={NPM} /></svg></a></li>
      <li><a href={CONTRACT_URL} target="_blank" rel="noopener" aria-label={`The contract ${MARKET_ID} on NearBlocks`}><svg className="ln" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4zM4 7.4l8 4.6 8-4.6M12 12v9.2" /></svg></a></li>
    </ul>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="ft-brand">
          <Link className="ft-logo" href="/" aria-label="Priced In, home" prefetch={false}><Lockup /></Link>
          <p className="ft-line">Is it true? <span>Bet on it.</span></p>
          <p className="ft-desc">Prediction markets for facts, on NEAR.</p>
        </div>

        <div className="ft-main">
          <section className="ft-topicsec" aria-labelledby="ft-topics">
            <h2 id="ft-topics" className="ft-h">Facts by topic</h2>
            <Suspense fallback={<TopicList counts={null} />}><Topics /></Suspense>
          </section>
          <nav className="ft-groups" aria-label="Footer">
            {GROUPS.map((g) => (
              <div key={g.title} className="ft-col">
                <h2 className="ft-h">{g.title}</h2>
                <ul>{g.links.map((l) => <li key={l.href}><FootA l={l} /></li>)}</ul>
              </div>
            ))}
            {GROUPS.map((g) => (
              <details key={g.title} className="ft-acc">
                <summary><span>{g.title}</span><svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></summary>
                <ul>{g.links.map((l) => <li key={l.href}><FootA l={l} /></li>)}</ul>
              </details>
            ))}
          </nav>
        </div>

        <div className="ft-base">
          <Social />
          <p className="ft-legal">
            <span>© 2026 Priced In</span>
            <Link href="/terms" prefetch={false}>Terms</Link>
            <Link href="/privacy" prefetch={false}>Privacy</Link>
            <Link href="/trust" prefetch={false}>Trust</Link>
            <Link href="/status" prefetch={false}>Status</Link>
            <a href={REPO_URL} target="_blank" rel="noopener">Source code</a>
          </p>
          <div className="ft-theme"><ThemeToggle /></div>
        </div>

        <p className="ft-fine">
          <b>Runs on NEAR. Paid in USDC.</b> Priced In is a micro-stakes research preview on NEAR mainnet. Bets are in USDC and settle in the public contract <a href={CONTRACT_URL} target="_blank" rel="noopener">{MARKET_ID}</a>. Real-money trading isn’t available in the US or other <Link href="/terms#regions" prefetch={false}>restricted regions</Link>. The free $1 is free play: its winnings are score and can’t be cashed out. Rulings are made by AI models and can be wrong, and any ruling can be disputed with a bond inside its window. Trading involves risk of loss. See our <Link href="/terms" prefetch={false}>Terms</Link> and <Link href="/privacy" prefetch={false}>Privacy</Link>.
        </p>
        <p className="ft-fine">Facts quote Wikipedia, whose text is available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener license">CC BY-SA 4.0</a>.</p>
      </div>
    </footer>
  );
}
