// The fact card. It answers four things at a glance: what is claimed (the question), what the market
// thinks (the % and what it means), what I can do (Yes or No) and what I'd get back (on the buttons).
import Image from "next/image";
import Link from "next/link";
import { BetLinks } from "./Bet";
import { TopicIcon } from "./Brand";
import { Spark } from "./Chart";
import { WhyEstimate } from "./Explain";
import { Icon } from "./Icon";
import { money, plural } from "@/lib/format";
import { priceWords, type Fact } from "@/lib/model";

export function PctBlock({ f, reopened = false }: { f: Fact; reopened?: boolean }) {
  const w = priceWords(f, reopened);
  const pct = Math.round(f.price * 100);
  return (
    <div>
      <div className="pct num">{pct}<i>%</i></div>
      <span className="lab">
        <b>{w.means}</b>
        <span>{w.whose}</span>
        {w.firstRead && <WhyEstimate pct={Math.round((f.openPrice ?? f.price) * 100)} />}
      </span>
    </div>
  );
}

export function FactCard({ f, points, agents = [], reopened = false, recorded = false, eager = false }: {
  f: Fact; points?: [number, number][]; agents?: string[]; reopened?: boolean; recorded?: boolean; eager?: boolean;
}) {
  const href = `/c/${f.id}${recorded ? "?recorded=1" : ""}`;
  const settled = f.status === "settled";
  return (
    <article className={`card ${settled ? "settled" : ""}`} aria-labelledby={`q${f.id}`}>
      <Link className="art" href={href} tabIndex={-1} aria-hidden="true" prefetch={false}>
        <Image src={`/art/${f.art}.webp`} alt="" width={560} height={320} sizes="(max-width: 760px) 96px, (max-width: 1240px) 33vw, 330px" loading={eager ? "eager" : "lazy"} />
        <div className="top">
          <span className="tag"><TopicIcon icon={f.icon} />{f.topic}</span>
          {f.status === "deciding" && <span className="tag plain warn"><Icon name="clock" />Being decided</span>}
          {settled && <span className={`tag plain ${f.outcome ? "" : "no"}`}><Icon name="gavel" />Ruled {f.outcome ? "TRUE" : "FALSE"}</span>}
        </div>
        <div className="ov"><PctBlockStatic f={f} reopened={reopened} /></div>
      </Link>
      <div className="cbody">
        <Link className="q" id={`q${f.id}`} href={href} prefetch={false}>{f.question}</Link>
        <div className="odds"><PctBlock f={f} reopened={reopened} />{points && points.length > 1 && f.trades > 0 && <Spark points={points} />}</div>
        {f.caught?.line && (
          <p className="ev"><Icon name="flag" /><span><b>Wikipedia may be wrong.</b> A newer source says {f.caught.line}.</span></p>
        )}
        {settled ? (
          <div className="result"><span>3 AI judges ruled it <b className={f.outcome ? "pos" : "neg"}>{f.outcome ? "true" : "false"}</b></span><Link className="link" href={href}>See the ruling</Link></div>
        ) : (
          <BetLinks id={f.id} quotes={f.quotes} question={f.question} recorded={recorded} />
        )}
        <div className="meta">
          <span className="l">{f.trades ? <><span>{money(f.volumeUsd)} bet</span><span>{plural(f.trades, "bet")}</span></> : <span>No bets yet. Be the first.</span>}</span>
          {agents.length > 0 && (
            <span className="who"><span className="ags">{agents.map((a) => <span key={a} className={`ag ${a}`} title={`The ${a}, an AI trader`}>{a[0]}</span>)}</span>{plural(agents.length, "AI trader")}</span>
          )}
        </div>
      </div>
    </article>
  );
}

/** The % on the art (desktop): no "?" button there, the art is one link. */
function PctBlockStatic({ f, reopened }: { f: Fact; reopened: boolean }) {
  const w = priceWords(f, reopened);
  return (
    <div>
      <div className="pct num">{Math.round(f.price * 100)}<i>%</i></div>
      <span className="lab"><b>{w.means}</b><span>{w.whose}</span></span>
    </div>
  );
}
