// The fact card. It answers four things at a glance: what is claimed (the question), what the market
// thinks (the % and what it means, with its step chart), what I can do (Yes or No) and, in plain money,
// what happens if I'm right or wrong.
import Image from "next/image";
import Link from "next/link";
import { BetLinks } from "./Bet";
import { TopicIcon } from "./Brand";
import { Spark } from "./Chart";
import { WhyEstimate } from "./Explain";
import { Icon } from "./Icon";
import { money, plural } from "@/lib/format";
import { priceWords, type Fact } from "@/lib/model";

/** The % and what it means, with the one-tap "?" unless `explain` is off (the art is one link). */
export function PctBlock({ f, reopened = false, explain = true }: { f: Fact; reopened?: boolean; explain?: boolean }) {
  const w = priceWords(f, reopened);
  return (
    <div>
      <div className="pct num">{Math.round(f.price * 100)}<i>%</i></div>
      <span className="lab">
        <b>{w.means}</b>
        <span>{w.whose}</span>
        {explain && w.firstRead && <WhyEstimate pct={Math.round((f.openPrice ?? f.price) * 100)} />}
      </span>
    </div>
  );
}

const sparkLabel = (f: Fact) => `${plural(f.trades, "bet")}: ${Math.round((f.openPrice ?? f.price) * 100)}% at the start, ${Math.round(f.price * 100)}% now`;

export function FactCard({ f, points, reopened = false, eager = false }: {
  f: Fact; points?: [number, number][]; reopened?: boolean; eager?: boolean;
}) {
  const href = `/c/${f.id}`;
  const settled = f.status === "settled";
  const spark = points && f.trades > 0 ? <Spark points={points} w={120} h={40} label={sparkLabel(f)} /> : <span className="nobets">No bets yet</span>;
  return (
    <article className={`card ${settled ? "settled" : ""}`} aria-labelledby={`q${f.id}`}>
      <Link className="art" href={href} tabIndex={-1} aria-hidden="true" prefetch={false}>
        <Image src={`/art/${f.art}.webp`} alt="" width={560} height={320} sizes="(max-width: 760px) 96px, (max-width: 1240px) 33vw, 330px" loading={eager ? "eager" : "lazy"} />
        <div className="top">
          <span className="tag"><TopicIcon icon={f.icon} />{f.topic}</span>
          {f.status === "deciding" && <span className="tag plain warn"><Icon name="clock" />Being decided</span>}
          {settled && <span className={`tag plain ${f.outcome ? "" : "no"}`}><Icon name="gavel" />Ruled {f.outcome ? "TRUE" : "FALSE"}</span>}
        </div>
        <div className="ov"><PctBlock f={f} reopened={reopened} explain={false} /><span className="ovspark">{spark}</span></div>
      </Link>
      <div className="cbody">
        <Link className="q" id={`q${f.id}`} href={href} prefetch={false}>{f.question}</Link>
        <div className="odds"><PctBlock f={f} reopened={reopened} />{spark}</div>
        {f.caught?.line && (
          <p className="ev"><Icon name="flag" /><span><b>Wikipedia may be wrong.</b> A newer source says {f.caught.line}.</span></p>
        )}
        {settled ? (
          <div className="result"><span>The AI judges ruled it <b className={f.outcome ? "pos" : "neg"}>{f.outcome ? "true" : "false"}</b></span><Link className="link" href={href}>See the ruling</Link></div>
        ) : (
          <BetLinks id={f.id} quotes={f.quotes} question={f.question} />
        )}
        <div className="meta">
          <span>{settled ? "Decided" : "Wrong: you lose $1"}</span>
          <span>{f.trades ? `${plural(f.trades, "bet")} · ${money(f.volumeUsd)}` : "Be the first to bet"}</span>
        </div>
      </div>
    </article>
  );
}
