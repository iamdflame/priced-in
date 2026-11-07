// What the bet is on and who settles it: the source in plain view, and the rules one glance below.
import { Icon } from "../Icon";
import { dayTimeUtc } from "@/lib/format";
import type { Fact } from "@/lib/model";
import { headlineOf, outletOf } from "@/lib/news";
import type { Market } from "@/lib/server/market";

export function Sources({ f, wiki, corrected }: { f: Fact; wiki: Market["wiki"]; corrected: boolean }) {
  return (
    <div className="panel wiki">
      <div>
        <div className="h"><Icon name="book" />What Wikipedia says (what you’re betting on)</div>
        <p className="quote">“{f.text}”</p>
        <a className="src" href={wiki.url} target="_blank" rel="noopener">Wikipedia: {wiki.title}<Icon name="ext" /></a>
      </div>
      <div>
        <div className="h"><Icon name="flag" />What a newer source says</div>
        {f.caught ? (
          <><p className="big-v">{f.caught.today}</p><a className="src" href={f.caught.source} target="_blank" rel="noopener nofollow">{f.caught.label}, checked {f.caught.checked}<Icon name="ext" /></a></>
        ) : corrected ? (
          <p className="big-v">This is the newer source’s figure, now in the sentence.</p>
        ) : (
          <p className="none">Our check found no newer source that contradicts it. The AI traders’ own sources are on the Discussion tab.</p>
        )}
      </div>
    </div>
  );
}

export function Rules({ f, wiki }: { f: Fact; wiki: Market["wiki"] }) {
  return (
    <div className="panel rules">
      <div><h2>How Yes or No wins</h2><p>Yes wins if the sentence is accurate as written on the day it’s decided. No wins if a newer, cited source contradicts it.</p></div>
      <div><h2>Who decides</h2><p>Three AI judges, each a different attested model, rule within minutes of a challenge and sign on-chain. Then anyone can object for 10 minutes.</p></div>
      <div><h2>Where it’s from</h2><p>{wiki.attribution ?? `Wikipedia: ${wiki.title}.`}{f.caught ? ` Checked against ${f.caught.label}.` : ""}</p></div>
    </div>
  );
}

/** A line from today's news: the claim word for word (what you're betting on), the headline it came
 *  from, and whose word settles it, by when. */
export function NewsSources({ f }: { f: Fact }) {
  const n = f.news!;
  const h = headlineOf(n.source);
  const outlet = outletOf(n.source);
  return (
    <div className="panel wiki news">
      <div>
        <div className="h"><Icon name="book" />What you’re betting on</div>
        <p className="quote">“{f.text}”</p>
        {n.why && <p className="why">Why it matters: {n.why}</p>}
      </div>
      <div>
        <div className="h"><Icon name="flag" />Where it came from</div>
        {h && n.source ? (
          <>
            <p className="big-v">“{h}”</p>
            <a className="src" href={n.source.url} target="_blank" rel="noopener nofollow">{outlet ?? "The report"}{n.source.published_at ? `, ${dayTimeUtc(n.source.published_at)}` : ""}<Icon name="ext" /></a>
          </>
        ) : <p className="none">The report it came from isn’t on record.</p>}
        <div className="h settle-h"><Icon name="clock" />Who settles it, by when</div>
        <p className="big-v">{n.settles.source}, by {n.settles.by_words}</p>
        {n.settles.source_url && <a className="src" href={n.settles.source_url} target="_blank" rel="noopener nofollow">{n.settles.source_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}<Icon name="ext" /></a>}
      </div>
    </div>
  );
}

export function NewsRules({ f }: { f: Fact }) {
  const n = f.news!;
  return (
    <div className="panel rules">
      <div><h2>How Yes or No wins</h2><p>Yes wins if {n.settles.source} confirms it by {n.settles.by_words}. Reports citing unnamed sources don’t count. No wins if the date passes without that, or the source denies it.</p></div>
      <div><h2>Who decides</h2><p>After the date, our settler reads the named source. Three AI judges rule on its receipts and sign on-chain, then anyone can object for 10 minutes. A late result is better than a wrong one: a line waits until its receipts check out.</p></div>
      <div><h2>Where it’s from</h2><p>{outletOf(n.source) ? `Reported by ${outletOf(n.source)}` : "A news report"}{n.source?.published_at ? `, ${dayTimeUtc(n.source.published_at)}` : ""}. Nobody had confirmed it when this line opened.</p></div>
    </div>
  );
}
