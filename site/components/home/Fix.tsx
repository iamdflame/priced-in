// The product in one real example, on the first screen: the figure Wikipedia gives, struck through; the
// figure this page gives now; and who ruled, with each judge's transaction. Every word and number comes
// from /api/rulings: the two figures are read out of the two sentences (lib/figures.ts), never typed in,
// and when a correction isn't a change of figure the two sentences stand side by side instead.
import Link from "next/link";
import { Icon } from "../Icon";
import { figures } from "@/lib/figures";
import { explorerTx, money } from "@/lib/format";
import type { Ruling } from "@/lib/server/api";

/** "deepseek-ai/DeepSeek-V4.1-Flash-1017" reads as "DeepSeek-V4.1-Flash". */
const judgeName = (model: string) => (model.split("/").pop() ?? model).replace(/-\d{4}$/, "");

export function Fix({ r }: { r: Ruling }) {
  if (!r.correction) return null;
  const agreed = r.verdicts.filter((v) => v.verdict.toUpperCase() === (r.outcome ?? "").toUpperCase());
  const fig = figures(r.claim, r.correction.text);
  return (
    <section className={`fix${fig ? " figs" : ""}`} aria-labelledby="fix-h">
      <div className="fix-top">
        <div className="fix-what">
          <h2 id="fix-h">A real correction</h2>
          {fig && <p className="fix-said"><span>Wikipedia:</span> “{r.claim}”</p>}
        </div>
        {fig ? (
          <div className="fix-figs">
            <p className="fix-was"><span className="fix-lab">Wikipedia says</span><del className="num">{fig.was}</del></p>
            <Icon name="arrow" />
            <p className="fix-now"><span className="fix-lab">This page says now</span><ins className="num">{fig.now}</ins></p>
          </div>
        ) : null}
      </div>
      {!fig && (
        <div className="fix-pair">
          <p className="fix-was"><span className="fix-lab">Wikipedia says</span><del>{r.claim}</del></p>
          <p className="fix-now"><span className="fix-lab">This page says now</span><ins>{r.correction.text}</ins></p>
        </div>
      )}
      <p className="fix-proof">
        <Icon name="gavel" />
        <span className="fix-long">
          <b>Ruled false by {agreed.length} AI judges</b>, each signing inside a secure chip:{" "}
          {agreed.map((v, i) => <span key={v.tx}>{i ? ", " : ""}<a className="link" href={explorerTx(v.tx)} target="_blank" rel="noopener">{judgeName(v.model)}</a></span>)}.
          {" "}The contract checked every signature{r.payout_usd ? <>, and {money(r.payout_usd)} went to the bets on No</> : null}.
        </span>
        <span className="fix-brief">
          <Link className="link" href={`/c/${r.claim_id}`}><b>Ruled false</b></Link> · {agreed.length} signatures{r.settle_tx ? <> · <a className="link" href={explorerTx(r.settle_tx)} target="_blank" rel="noopener">transaction</a></> : null}
        </span>
        <Link className="link fix-more" href={`/c/${r.claim_id}`}>See the ruling</Link>
      </p>
    </section>
  );
}
