// The scale and trust numbers, shown once near the top, every one read from the API or the chain.
import { Icon } from "../Icon";
import { explorerAccount, money } from "@/lib/format";
import { MARKET_ID } from "@/lib/nav";

export interface Proof { liveFacts: number; topics: number; bets: number; paidUsd: number; ruled: number }

export function ProofBar({ p }: { p: Proof }) {
  return (
    <ul className="proof" aria-label="The market in numbers">
      <li><b>{p.liveFacts}</b> live facts</li>
      <li><b>{p.topics}</b> topics</li>
      <li><b>{p.bets}</b> bets</li>
      <li><b>{money(p.paidUsd)}</b> paid out</li>
      <li><b>{p.ruled}</b> {p.ruled === 1 ? "ruling" : "rulings"} settled</li>
      <li className="pub"><a href={explorerAccount(MARKET_ID)} target="_blank" rel="noopener"><Icon name="shield" />Every bet is a public NEAR transaction<Icon name="ext" /></a></li>
    </ul>
  );
}
