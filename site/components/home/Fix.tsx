// The product in one real example, on the first screen: what Wikipedia says, struck through; what the
// page says now; and who ruled, with each judge's transaction. Every word and number is /api/rulings'.
import Link from "next/link";
import { Icon } from "../Icon";
import { explorerTx, money } from "@/lib/format";
import type { Ruling } from "@/lib/server/api";

/** "deepseek-ai/DeepSeek-V4.1-Flash-1017" reads as "DeepSeek-V4.1-Flash". */
const judgeName = (model: string) => (model.split("/").pop() ?? model).replace(/-\d{4}$/, "");

export function Fix({ r, ruledQ, correctedQ }: { r: Ruling; ruledQ?: string; correctedQ?: string }) {
  if (!r.correction) return null;
  const agreed = r.verdicts.filter((v) => v.verdict.toUpperCase() === (r.outcome ?? "").toUpperCase());
  return (
    <section className="fix" aria-labelledby="fix-h">
      <h2 id="fix-h" className="sr-only">A real correction</h2>
      {/* a phone gets the two questions, which keep both numbers in two lines; a wide screen gets the sentences */}
      {ruledQ && correctedQ && (
        <div className="fix-pair fix-short">
          <p className="fix-was"><span className="fix-lab">Wikipedia’s line</span><del>{ruledQ}</del></p>
          <p className="fix-now"><span className="fix-lab">Corrected to</span><ins>{correctedQ}</ins></p>
        </div>
      )}
      <div className={`fix-pair${ruledQ && correctedQ ? " fix-long" : ""}`}>
        <p className="fix-was"><span className="fix-lab">Wikipedia says</span><del>{r.claim}</del></p>
        <p className="fix-now"><span className="fix-lab">This page says now</span><ins>{r.correction.text}</ins></p>
      </div>
      <p className="fix-proof">
        <Icon name="gavel" />
        <span>
          <b>Ruled false by {agreed.length} AI judges</b><span className="fix-detail">, each signing inside a secure chip:{" "}
          {agreed.map((v, i) => <span key={v.tx}>{i ? ", " : ""}<a className="link" href={explorerTx(v.tx)} target="_blank" rel="noopener">{judgeName(v.model)}</a></span>)}.
          {" "}The contract checked every signature{r.payout_usd ? <>, and {money(r.payout_usd)} went to the bets on No</> : null}.</span>
        </span>
        <Link className="link fix-more" href={`/c/${r.claim_id}`}>See the ruling</Link>
      </p>
    </section>
  );
}
