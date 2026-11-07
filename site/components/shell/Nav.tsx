"use client";
// The top of every page: the replay bar when it's on, the desktop nav and the phone's top bar.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Lockup } from "../Brand";
import { Icon } from "../Icon";
import { MoneyLayer } from "../money/MoneyLayer";
import { WalletButton } from "../money/WalletButton";
import { NavMenu } from "./NavMenu";
import { Search } from "./Search";
import { ThemeToggle } from "./ThemeToggle";
import { navFor, REPLAY_HREF } from "@/lib/nav";

function ReplayBar() {
  return (
    <div className="replaybar" role="status">
      <div className="wrap">
        <span><b>Replay of a real mainnet run.</b><span className="long"> The free $1 on the T-Bills fact, its signed rewrite and the AI judges’ ruling, as recorded on 5–6 Nov 2026.</span> Nothing is sent.</span>
        <a href="/">Back to live</a>
      </div>
    </div>
  );
}

export function Nav({ news = false }: { news?: boolean }) {
  const path = usePathname();
  const items = navFor(news);
  const recorded = useSearchParams().get("recorded") === "1";
  const cta = recorded ? REPLAY_HREF : "/#facts";
  return (
    <>
      {recorded && <ReplayBar />}
      <header className="nav">
        <div className="wrap">
          <Link className="logo" href="/" aria-label="Priced In, home"><Lockup /></Link>
          <Search />
          <nav className="navlinks" aria-label="Main">
            {items.map((n) => (
              <Link key={n.href} href={n.href} aria-current={(n.match ? n.match(path) : path === n.href) ? "page" : undefined}>{n.label}</Link>
            ))}
          </nav>
          <div className="nav-actions">
            <ThemeToggle />
            <WalletButton />
            <Link className="btn primary" href={cta}>Bet $1 free</Link>
            <NavMenu news={news} />
          </div>
        </div>
      </header>
      <div className="pbar">
        <Link className="logo" href="/" aria-label="Priced In, home"><Lockup /></Link>
        <div className="r">
          <Link className="iconbtn" href="/#facts" aria-label="Search facts"><Icon name="search" /></Link>
          <WalletButton />
          <Link className="btn primary" href={cta}>Free $1</Link>
        </div>
      </div>
      <MoneyLayer />
    </>
  );
}
