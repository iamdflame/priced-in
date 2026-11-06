// The footer carries the trust line: NEAR is named here and in the trust line, not on the first screen.
import Link from "next/link";
import { Icon } from "./Icon";
import { MARKET_ID, REPO_URL } from "@/lib/nav";
import { explorerAccount } from "@/lib/format";

export function Footer({ asOf }: { asOf?: number | null }) {
  return (
    <footer className="foot">
      <div className="wrap">
        <p className="trust">
          <b>Every bet is a public NEAR transaction.</b> Prices come from the market contract <a className="link" href={explorerAccount(MARKET_ID)} target="_blank" rel="noopener">{MARKET_ID}</a>, paid in USDC. Rulings are signed on-chain by 3 attested AI models.
          {asOf ? <> Prices read {new Date(asOf).toISOString().slice(0, 16).replace("T", " ")} UTC.</> : null}
        </p>
        <nav aria-label="Footer">
          <Link href="/#how">How it works</Link>
          <Link href="/c/18?recorded=1">Watch a replay</Link>
          <a href="/v1" target="_blank" rel="noopener">Truth API</a>
          <a href={REPO_URL} target="_blank" rel="noopener">Source code <Icon name="ext" className="inline-block w-3 h-3" /></a>
        </nav>
      </div>
    </footer>
  );
}
