"use client";
// Ask the truth API from the page. A real call from the visitor's browser, so it counts against their
// own free tier, and the answer says how many they have left.
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Icon } from "../Icon";

interface Answer { answer: string; matched: number; claims: { claim_id: number; credence: number; summary: string }[]; free?: { limit: number; remaining: number } }

type State = { at: "idle" } | { at: "busy" } | { at: "done"; a: Answer } | { at: "failed"; message: string };

export function TruthTry({ placeholder }: { placeholder: string }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>({ at: "idle" });
  async function ask(e: FormEvent) {
    e.preventDefault();
    const question = q.trim() || placeholder;
    setState({ at: "busy" });
    try {
      const r = await fetch(`/api/v1/credence?q=${encodeURIComponent(question)}&limit=1`, { headers: { accept: "application/json" } });
      const body = await r.json().catch(() => null);
      setState(r.ok && body ? { at: "done", a: body } : { at: "failed", message: body?.error?.message ?? "The truth API didn’t answer. Try again in a moment." });
    } catch {
      setState({ at: "failed", message: "The truth API didn’t answer. Try again in a moment." });
    }
  }
  const hit = state.at === "done" ? state.a.claims[0] : null;
  return (
    <div className="panel try">
      <form onSubmit={ask}>
        <div className="ask">
          <label className="sr-only" htmlFor="truth-q">Ask a question</label>
          <input id="truth-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} maxLength={600} autoComplete="off" />
          <button type="submit" className="btn primary lg" disabled={state.at === "busy"}>{state.at === "busy" ? "Asking…" : "Ask"}</button>
        </div>
        <p className="fine try-note">A real call to <span className="tcode">GET /v1/credence</span>. The match is by words: it finds the closest fact, which may not answer your exact question.</p>
      </form>
      <div className="answer" aria-live="polite">
        {state.at === "idle" && <p>The answer comes with the market’s price, the money behind it and how it was decided.</p>}
        {state.at === "busy" && <p className="waiting"><span className="spin" aria-hidden="true" />Reading the market…</p>}
        {state.at === "failed" && <p className="sig bad"><Icon name="alert" />{state.message}</p>}
        {state.at === "done" && (
          <>
            {hit && <div className="pct num">{Math.round(hit.credence * 100)}<i>%</i><span className="lab">chance it’s true</span></div>}
            <p>{hit?.summary ?? state.a.answer}</p>
            {hit && <Link className="link" href={`/c/${hit.claim_id}`}>See the fact</Link>}
            {state.a.free && <p className="fine">{state.a.free.remaining} of {state.a.free.limit} free calls left today.</p>}
          </>
        )}
      </div>
    </div>
  );
}
