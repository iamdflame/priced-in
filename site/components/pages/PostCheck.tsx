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

type State = { at: "loading" } | { at: "done"; post: PostResult } | { at: "failed"; error: ApiFailure };

export function PostCheck({ user, id }: { user: string; id: string }) {
  const [state, setState] = useState<State>({ at: "loading" });
  const load = useCallback(async () => {
    setState({ at: "loading" });
    const r = await browserApi.post(`${user}/status/${id}`);
    setState(r.ok ? { at: "done", post: r.value } : { at: "failed", error: r.error });
  }, [user, id]);
  useEffect(() => { void load(); }, [load]);

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
  return (
    <>
      <article className="panel postc">
        <div className="au">
          <span className="av" aria-hidden="true">{p.post.authorName.charAt(0).toUpperCase()}</span>
          <div><b>{p.post.authorName}</b><small>@{p.post.handle}{p.post.date ? ` · ${p.post.date}` : ""}</small></div>
        </div>
        <p className="tx">{p.post.text}</p>
        <a className="src" href={p.post.url} target="_blank" rel="noopener">See it on X<Icon name="ext" /></a>
      </article>
      {p.notices.map((n) => <p key={n.code} className="notice info result-gap"><Icon name="info" /><span>{n.message}</span></p>)}
      <div className="shead">
        <div>
          <h2>{checkable ? `${checkable === 1 ? "1 checkable line" : `${checkable} checkable lines`}, priced` : "Nothing here to bet on"}</h2>
          <p>{checkable ? "Each estimate is our AI’s starting read, before anyone has bet." : p.voice ?? p.message ?? "Every line is opinion or can’t be checked."}</p>
        </div>
      </div>
      <PricedLines sentences={p.sentences} label="The post’s lines, as our AI read them" />
    </>
  );
}
