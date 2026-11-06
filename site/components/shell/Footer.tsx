// The footer carries the trust line: NEAR is named here and in the trust line, not on the first screen.
import Link from "next/link";
import { Icon } from "../Icon";
import { explorerAccount } from "@/lib/format";
import { MARKET_ID, REPLAY_HREF, REPO_URL } from "@/lib/nav";

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <p className="trust">
          <b>Every bet is a public NEAR transaction.</b> Prices come from the market contract <a className="link" href={explorerAccount(MARKET_ID)} target="_blank" rel="noopener">{MARKET_ID}</a>, paid in USDC. Rulings are signed on-chain by attested AI models.
        </p>
        <nav aria-label="Footer">
          <Link href="/#how">How it works</Link>
          <Link href={REPLAY_HREF}>Watch a replay</Link>
          <Link href="/stats">The numbers</Link>
          <Link href="/trust">Trust</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/p">Encyclopedia</Link>
          <Link href="/new">Price a claim</Link>
          <Link href="/developers">Developers</Link>
          <a href={REPO_URL} target="_blank" rel="noopener">Source code <Icon name="ext" className="inline-block !w-3 !h-3" /></a>
        </nav>
      </div>
    </footer>
  );
}
