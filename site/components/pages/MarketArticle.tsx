"use client";
// An official page (OFFICIAL_PAGES=1): written by AI from what the market believes right now, with one tap
// to Wikipedia's words. Priced sentences stay tinted and open their market; a line nobody has bet on shows
// it has a market but no view yet; decided lines read as decided. Each changed paragraph can show its word
// diff and its proof. The market's page is set in Geist, the product's reading face, and Wikipedia's words
// in Amstelvar, the face this site keeps for quoting Wikipedia: switching views switches the face too, so
// it's always clear whose words you're reading.
import Link from "next/link";
import { useCallback, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Icon } from "../Icon";
import { Ago } from "../Live";
import { Sheet } from "./HeatArticle";
import { modelShort, shortHash } from "@/lib/format";
import type { Fact } from "@/lib/model";
import { groupsOf, pricesWords, type PageMood, type SlimLine, type SlimParagraph, type SlimProof } from "@/lib/pages";

export type View = "market" | "wikipedia";
type Tap = (id: number) => (e: MouseEvent<HTMLAnchorElement>) => void;
interface Ctx { view: View; facts: Map<number, Fact>; openId: number | null; onTap: Tap }

const pctOf = (p: number) => Math.round(p * 100);

/** What the mark beside a priced sentence says, its tint and its class, in either view. */
export function markOf(l: SlimLine, view: View) {
  const c = l.claim!;
  const market = view === "market";
  if (!market && l.ruled !== undefined) return { id: l.ruled, sup: "Ruled false", said: "Ruled false", h: 0, cls: "gone" };
  if (c.decided && c.outcome === "true") return { id: c.id, sup: "Ruled true", said: "Ruled true", h: 1, cls: "decided" };
  if (c.decided) {
    if (!market) return { id: c.id, sup: "Ruled false", said: "Ruled false", h: 0, cls: "gone" };
    if (l.by === "ai") return { id: c.id, sup: "Corrected", said: "Ruled false, and corrected from its source", h: 1, cls: "new" };
    return { id: c.id, sup: "Ruled false", said: "Ruled false", h: 0, cls: "decided" };
  }
  if (!c.trades) return { id: c.id, sup: "No bets", said: `No bets yet; our AI’s starting estimate is ${pctOf(c.price)}%`, h: c.price, cls: "unbet" };
  return { id: c.id, sup: `${pctOf(c.price)}%`, said: `${pctOf(c.price)}% chance it’s true`, h: c.price, cls: "" };
}

function Line({ l, ctx }: { l: SlimLine; ctx: Ctx }) {
  const text = ctx.view === "market" ? l.text : l.wiki ?? l.text;
  if (!l.claim) return <span className={l.opinion ? "op" : undefined}>{text} </span>;
  const m = markOf(l, ctx.view);
  const sheet = ctx.facts.has(m.id);
  return (
    <span className={l.opinion ? "op" : undefined}>
      <a className={`hs ${m.cls}`} href={`/c/${m.id}`} style={{ "--h": m.h } as CSSProperties} aria-haspopup={sheet ? "dialog" : undefined} aria-expanded={sheet ? ctx.openId === m.id : undefined} aria-label={`${text} ${m.said}`} onClick={sheet ? ctx.onTap(m.id) : undefined}>
        {text}<sup aria-hidden="true">{m.sup}</sup>
      </a>{" "}
    </span>
  );
}

function Proof({ r }: { r: SlimProof }) {
  return (
    <dl className="prf">
      <div><dt>{r.correction ? "Corrected wording" : "Rewritten"}</dt><dd><Ago at={r.at} />, by {modelShort(r.model)}</dd></div>
      {r.correction ? <div><dt>Why</dt><dd>The line was ruled false, and its source gave the right wording</dd></div> : <div><dt>From the odds</dt><dd>{pricesWords(r.prices)} chance it’s true</dd></div>}
      <div><dt>Signature</dt><dd className={r.signed === "signed" ? "signed" : undefined}>{r.signed === "signed" ? <><Icon name="check" />Signed in a TEE by the model’s attested key</> : "Waiting for its signature"}</dd></div>
      <div><dt>On NEAR</dt><dd>{r.tx && r.explorer ? <a className="link hash" href={r.explorer} target="_blank" rel="noopener" aria-label={`The anchor transaction on NEAR, ${r.tx}`}>{shortHash(r.tx)}</a> : "Not anchored yet"}</dd></div>
    </dl>
  );
}

function Changed({ p, id, hidden }: { p: SlimParagraph; id: string; hidden: boolean }) {
  return (
    <div className="chg-body" id={id} hidden={hidden}>
      {p.diff && (
        <>
          <p className="chg-key">Struck words are Wikipedia’s. Highlighted words are the AI’s.</p>
          <p className="chg-diff">{p.diff.map((o, i) => (o.op === "ins" ? <ins key={i}>{o.text}</ins> : o.op === "del" ? <del key={i}>{o.text}</del> : <span key={i}>{o.text}</span>))}</p>
        </>
      )}
      {p.rulings?.map((r) => <p key={r.id} className="chg-ruled"><span className={`verdict ${r.outcome ?? ""}`}>Ruled {r.outcome}</span><span>by {r.by}.</span> <Link className="link" href={r.url}>See the ruling</Link></p>)}
      {p.proofs?.map((r) => <Proof key={r.id} r={r} />)}
      {p.proofs && <Link className="src" href="/trust">How to check a signature<Icon name="arrow" /></Link>}
    </div>
  );
}

/** The first words of a sentence, for the margin: enough to find it in the paragraph beside. */
const opening = (text: string, n = 6) => {
  const w = text.replace(/\s+/g, " ").trim().split(" ");
  return w.length > n ? `${w.slice(0, n).join(" ").replace(/[,;:]$/, "")}…` : w.join(" ");
};

/**
 * The margin beside a paragraph with a market (wide cards only, pages.css): each priced sentence's odds in the
 * paragraph's order, and how the paragraph came to read as it does. It repeats what the text and "What changed"
 * already say, so it's hidden from assistive tech and out of the tab order; a click still opens the market.
 */
function Note({ p, ctx }: { p: SlimParagraph; ctx: Ctx }) {
  const priced = p.lines.filter((l) => l.claim);
  if (!priced.length) return null;
  const market = ctx.view === "market";
  const proof = market ? p.proofs?.at(-1) : undefined;
  const ruled = market && !proof ? p.rulings?.[0] : undefined;
  return (
    <aside className="pnote" aria-hidden="true">
      <ul>
        {priced.map((l, i) => {
          const m = markOf(l, ctx.view);
          return (
            <li key={i}>
              <a className={`pn-m ${m.cls}`} href={`/c/${m.id}`} tabIndex={-1} style={{ "--h": m.h } as CSSProperties} onClick={ctx.facts.has(m.id) ? ctx.onTap(m.id) : undefined}>
                <i className="pn-dot" /><b>{m.sup}</b><span>{opening(market ? l.text : l.wiki ?? l.text)}</span>
              </a>
            </li>
          );
        })}
      </ul>
      {proof && (
        <p className="pn-proof">
          {proof.signed === "signed" ? <Icon name="check" /> : null}
          <span>{proof.correction ? "Corrected from its source" : "Rewritten from these odds"} <Ago at={proof.at} />{proof.model ? `, by ${modelShort(proof.model)}` : ""}{proof.signed === "signed" ? ". Signed" : ""}{proof.tx ? "; anchored on NEAR" : ""}.</span>
        </p>
      )}
      {ruled && <p className="pn-proof"><span>Ruled {ruled.outcome} by {ruled.by}.</span></p>}
      {market && !proof && !ruled && priced.every((l) => !l.claim!.trades && !l.claim!.decided) && <p className="pn-proof"><span>Wikipedia’s words until someone bets.</span></p>}
    </aside>
  );
}

function Paragraph({ p, ctx }: { p: SlimParagraph; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const id = `chg-${p.index}`;
  const changed = ctx.view === "market" && Boolean(p.diff || p.rulings || p.proofs);
  return (
    <>
      <p>{p.lines.map((l, i) => <Line key={i} l={l} ctx={ctx} />)}</p>
      <Note p={p} ctx={ctx} />
      {changed && (
        <div className="chg">
          <button type="button" className="chg-open" aria-expanded={open} aria-controls={id} onClick={() => setOpen((x) => !x)}>
            What changed<Icon name="chevron" />
          </button>
          <Changed p={p} id={id} hidden={!open} />
        </div>
      )}
    </>
  );
}

/** Two captions in one place, the other one hidden but holding its space, so the switch never moves under the pointer. */
function Both({ market, className, a, b }: { market: boolean; className: string; a: ReactNode; b: ReactNode }) {
  return <p className={`${className} both`}><span className={market ? undefined : "off"}>{a}</span><span className={market ? "off" : undefined}>{b}</span></p>;
}

const LEAD: Record<PageMood, ReactNode> = {
  written: <b>Written by AI from what the market believes right now.</b>,
  unbet: <><b>The AI rewrites this page from the odds once people bet.</b> Nobody has bet on its priced sentences yet, so it reads as Wikipedia does.</>,
  unpriced: <><b>No sentence on this page has a market yet,</b> so it reads as Wikipedia does.</>,
};

export function MarketArticle({ paragraphs, facts, written, mood, lastChanged, revised }: { paragraphs: SlimParagraph[]; facts: Fact[]; written: string; mood: PageMood; lastChanged: number | null; revised: string }) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const [view, setView] = useState<View>("market");
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const shut = useCallback(() => { setOpen(null); opener.current?.focus(); }, []);
  const onTap: Tap = (id) => (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    opener.current = e.currentTarget;
    setOpen(id);
  };
  const market = view === "market";
  const ctx: Ctx = { view, facts: byId, openId: open, onTap };
  return (
    <>
      <div className="viewbar">
        <Both market={market} className="said"
          a={<>{LEAD[mood]}{mood === "written" && lastChanged !== null && <> Last changed <Ago at={lastChanged} />.</>}</>}
          b={<><b>Wikipedia’s words,</b> from the revision of {revised}.</>} />
        <div className="vrow">
          <div className="tabs" role="group" aria-label="Whose words to read">
            <button type="button" className="tab" aria-pressed={market} onClick={() => setView("market")}>The market’s page</button>
            <button type="button" className="tab" aria-pressed={!market} onClick={() => setView("wikipedia")}>Wikipedia’s words</button>
          </div>
          <div className="heatkey" aria-hidden="true"><span>Likely false</span><span className="heatbar" /><span>Likely true</span></div>
        </div>
        <Both market={market} className="vnote"
          a={<>{written}. Tinted sentences have a market: tap one to see the odds and bet. The rest have none, so they keep Wikipedia’s words.</>}
          b={<>Every word here is Wikipedia’s. Tinted sentences have a market, and the tint shows what the market thinks: tap one to see the odds and bet.</>} />
      </div>
      <div className={`article ${market ? "mktv" : "wikiv"}`}>
        {groupsOf(paragraphs).map((g, i) => (
          <section key={i}>
            {g.first && g.top && <h2 id={g.id}>{g.top}</h2>}
            {g.sub && <h3>{g.sub}</h3>}
            {g.paragraphs.map((p) => <Paragraph key={`${view}-${p.index}`} p={p} ctx={ctx} />)}
          </section>
        ))}
      </div>
      {open !== null && byId.has(open) && <Sheet f={byId.get(open)!} onClose={shut} />}
    </>
  );
}
