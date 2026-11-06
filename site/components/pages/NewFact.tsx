"use client";
// Price your own claim: paste a sentence, a paragraph or an X link. Text goes to the planner; a post
// link goes to its own fact-check page. Every outcome is a designed state: pricing, the answer, nothing
// to price, the planner offline, and a refusal in the API's own words.
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "../Icon";
import { PricedLines } from "./PricedLines";
import { browserApi } from "@/lib/client/api";
import type { PasteResult } from "@/lib/core/api";

const POST_LINK = /^\s*(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})/i;

const EXAMPLES = [
  "Bitcoin has a hard cap of 21 million coins.",
  "The Ethereum network moved to proof of stake in September 2022.",
  "https://x.com/jack/status/20",
];

type State = { at: "idle" } | { at: "busy" } | { at: "done"; result: PasteResult } | { at: "failed"; message: string };

export function NewFact() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ at: "idle" });

  async function price(input: string) {
    const link = input.match(POST_LINK);
    if (link) { router.push(`/${link[1]}/status/${link[2]}`); return; }
    setState({ at: "busy" });
    const r = await browserApi.paste(input);
    setState(r.ok ? { at: "done", result: r.value } : { at: "failed", message: r.error.message });
  }
  const submit = (e: FormEvent) => { e.preventDefault(); if (text.trim()) void price(text); };
  const priced = state.at === "done" ? state.result.sentences.filter((s) => s.status === "priced" || s.status === "listed").length : 0;

  return (
    <>
      <form className="panel paste" onSubmit={submit}>
        <label className="sr-only" htmlFor="claim">A sentence, a paragraph or an X link</label>
        <textarea id="claim" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="Paste a sentence, a paragraph or an X link" />
        <div className="pactions">
          <div className="examples" aria-label="Examples">
            {EXAMPLES.map((x) => <button key={x} type="button" onClick={() => { setText(x); void price(x); }}>{x.startsWith("http") ? "An X post" : x}</button>)}
          </div>
          <button type="submit" className="btn primary lg" disabled={!text.trim() || state.at === "busy"}>
            {state.at === "busy" ? <><span className="spin" aria-hidden="true" />Reading it…</> : <>Price it<Icon name="arrow" /></>}
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {state.at === "failed" && <p className="notice err result-gap" role="alert"><Icon name="alert" /><span>{state.message} Nothing was opened or charged.</span></p>}
        {state.at === "done" && (
          <>
            {state.result.planner !== "ok" && <p className="notice result-gap"><Icon name="info" /><span>{state.result.message ?? "The planner is offline, so nothing is priced yet."} Try again in a moment.</span></p>}
            {state.result.planner === "ok" && priced === 0 && <p className="notice info result-gap"><Icon name="info" /><span>{state.result.message ?? "Nothing here can be priced."} Try a sentence with a number, a date or a named source.</span></p>}
            <div className="result-gap"><PricedLines sentences={state.result.sentences} label="Your sentences, as our AI read them" /></div>
            {state.result.truncated && <p className="fine result-note">We read the first {state.result.sentences.length} of {state.result.totalSentences} sentences.</p>}
            {state.result.model && <p className="fine result-note">Read by {state.result.model}. Estimates are clamped to 20–80% until money moves them.</p>}
          </>
        )}
      </div>
    </>
  );
}
