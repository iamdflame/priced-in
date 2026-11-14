"use client";
// "Fact-check this post": an X post's checkable lines, priced. It loads in the visitor's browser so the
// API's limit on new posts counts the visitor, not this site's server. A deleted or private post is a
// designed result: we show nothing of it, not an error.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../Icon";
import { Sk, StateBox } from "../States";
import { PricedLines } from "./PricedLines";
import { browserApi } from "@/lib/client/api";
import type { ApiFailure, PostResult } from "@/lib/core/api";
import type { LiveFact } from "@/lib/related";

type State = { at: "loading" } | { at: "done"; post: PostResult } | { at: "failed"; error: ApiFailure };

// The planner (an AI model) sometimes answers late. The page asks again by itself, after these waits,
// before it says that nothing here is priced.
export const RETRY_MS = [3000, 6000, 12000];
/** A post longer than this is shown by its first lines, so its priced lines sit on the first screen. */
export const LONG_POST = 420;

export function PostCheck({ user, id, live = [] }: { user: string; id: string; live?: LiveFact[] }) {
  const [state, setState] = useState<State>({ at: "loading" });
  const [tries, setTries] = useState(0);
  const [whole, setWhole] = useState(false);
  const load = useCallback(async () => {
    setState({ at: "loading" });
    setTries(0);
    const r = await browserApi.post(`${user}/status/${id}`);
    setState(r.ok ? { at: "done", post: r.value } : { at: "failed", error: r.error });
  }, [user, id]);
  useEffect(() => { void load(); }, [load]);
  const waiting = state.at === "done" && !state.post.gone && state.post.planner === "unavailable" && tries < RETRY_MS.length;
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(async () => {
      const r = await browserApi.post(`${user}/status/${id}`);
      if (r.ok) setState({ at: "done", post: r.value });
      setTries((n) => n + 1);
    }, RETRY_MS[tries]);
    return () => clearTimeout(t);
  }, [waiting, tries, user, id]);

  if (state.at === "loading") {
    return (
      <div aria-busy="true" aria-label="Reading the post">
        <div className="panel postc"><Sk w={220} h={44} /><Sk h={22} /><Sk w="70%" h={22} /></div>
        <div className="panel postc result-gap"><Sk h={20} /><Sk w="50%" h={14} /></div>
      </div>
    );
  }
  if (state.at === "failed") {
    return (
      <StateBox icon="alert" title="We couldn’t read this post" actions={<><button type="button" className="btn primary" onClick={load}><Icon name="refresh" />Try again</button><Link className="btn soft" href="/new">Paste the text instead</Link></>}>
        {state.error.message}
      </StateBox>
    );
  }
  const p = state.post;
  if (p.gone) {
    return <StateBox icon="info" title={p.reason === "private" ? "This post is private" : "This post was deleted"} actions={<Link className="btn soft" href="/">See live facts</Link>}>{p.message} We honour that: nothing of it is kept here.</StateBox>;
  }
  const checkable = p.sentences.filter((s) => s.status === "priced" || s.status === "listed").length;
  const clamp = checkable > 0 && p.post.text.length > LONG_POST && !whole;
  return (
    <>
      <article className="panel postc">
        <div className="au">
          <span className="av" aria-hidden="true">{p.post.authorName.charAt(0).toUpperCase()}</span>
          <div><b>{p.post.authorName}</b><small>@{p.post.handle}{p.post.date ? ` · ${p.post.date}` : ""}</small></div>
        </div>
        <p className={clamp ? "tx clamp" : "tx"}>{p.post.text}</p>
        {clamp && <button type="button" className="more" onClick={() => setWhole(true)}>Read the whole post<Icon name="chevron" /></button>}
        {p.post.truncated && <a className="more" href={p.post.url} target="_blank" rel="noopener">The post continues on X<Icon name="ext" /></a>}
        <a className="src" href={p.post.url} target="_blank" rel="noopener">See it on X<Icon name="ext" /></a>
      </article>
      {p.notices.map((n) => <p key={n.code} className="notice info result-gap"><Icon name="info" /><span>{n.message}</span></p>)}
      <div className="shead">
        <div>
          <h2 aria-live="polite">{checkable ? `${checkable === 1 ? "1 checkable line" : `${checkable} checkable lines`}, priced` : waiting ? "Pricing this post…" : "Nothing here to bet on"}</h2>
          <p>{checkable ? "Each % is our AI’s estimate, before anyone has bet. Beside it: the closest live fact to bet on now, or how the line becomes a market of its own." : waiting ? "Our AI is reading each line. This takes a few seconds." : p.voice ?? p.message ?? "Every line is opinion or can’t be checked."}</p>
        </div>
      </div>
      <PricedLines sentences={p.sentences} label="The post’s lines, as our AI read them" live={live} />
    </>
  );
}
