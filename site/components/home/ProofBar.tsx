// The scale and trust numbers, shown once near the top, every one read from the API or the chain.
import { Icon } from "../Icon";
import { explorerAccount, money } from "@/lib/format";
import { MARKET_ID } from "@/lib/nav";
import type { Proof } from "@/lib/server/site";

// Each says what it counts, and the fact counts are the ones the tabs, "See all" and the footer show.
export function ProofBar({ p, news = false }: { p: Proof; news?: boolean }) {
  return (
    <ul className="proof" aria-label="The market in numbers">
      <li><b>{p.wikiFacts}</b> {p.wikiFacts === 1 ? "fact" : "facts"} from Wikipedia</li>
      <li><b>{p.topics}</b> {p.topics === 1 ? "topic" : "topics"}</li>
      {news && p.newsOpen > 0 && <li><b>{p.newsOpen}</b> news {p.newsOpen === 1 ? "claim" : "claims"} open</li>}
      <li><b>{p.bets}</b> {p.bets === 1 ? "bet" : "bets"}</li>
      <li><b>{money(p.paidUsd)}</b> paid out</li>
      <li><b>{p.decided}</b> {p.decided === 1 ? "fact" : "facts"} decided</li>
      <li className="pub"><a href={explorerAccount(MARKET_ID)} target="_blank" rel="noopener"><Icon name="shield" />Every bet is a public NEAR transaction<Icon name="ext" /></a></li>
    </ul>
  );
}
