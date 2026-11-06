// What the bet is on and who settles it: the source in plain view, and the rules one glance below.
import { Icon } from "../Icon";
import type { Fact } from "@/lib/model";
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
