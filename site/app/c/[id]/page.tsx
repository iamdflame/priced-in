// The market page for one fact, in the order a stranger needs it: the question and the % with its
// meaning; the chart; the ticket; what Wikipedia says and what a newer source says; the rules and who
// decides; the activity, the AI traders' reasons and the history; and the ruling when there is one.
// The claim is read before the first byte, so a missing fact is a real 404; the rest streams in.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MarketBody, MarketHead, MarketSkeleton } from "@/components/market/MarketBody";
import { ErrorState } from "@/components/States";
import { REPLAY, preBetClaim } from "@/lib/replay/record";
import { api } from "@/lib/server/api";
import { toFact } from "@/lib/server/facts";
import { getNews } from "@/lib/server/news";

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const idOf = (raw: string) => (/^\d{1,9}$/.test(raw) ? Number(raw) : null);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const id = idOf((await params).id);
  if (id === null) return { title: "Not found" };
  const r = await api.claim(id);
  if (!r.ok) return { title: "A fact on Priced In" };
  const f = toFact(r.value);
  const description = f.status === "settled" ? `Decided ${f.outcome ? "true" : "false"} by AI judges. ${f.text}` : `${Math.round(f.price * 100)}% chance it’s true. Bet $1 free on Yes or No: three AI judges decide, right answers win.`;
  return { title: f.question, description, openGraph: { title: f.question, description }, twitter: { title: f.question, description } };
}

export default async function MarketPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const id = idOf((await params).id);
  if (id === null) notFound();
  const search = await searchParams;
  const r = await api.claim(id);
  if (!r.ok) {
    if (r.status === 404) notFound();
    return <main id="main" className="wrap"><div className="pagegap"><ErrorState message={r.error} /></div></main>;
  }
  const recorded = search.recorded === "1" && id === REPLAY.claimId;
  // the replay starts from the claim as it stood just before the real free $1
  const claim = recorded ? preBetClaim() : r.value;
  const side = search.side === "yes" || search.side === "no" ? search.side : null;
  const head = toFact(claim);
  const news = recorded ? null : await getNews();
  return (
    <main id="main" className="wrap market">
      <div className="mk">
        <MarketHead f={head} report={!!news?.on && claim.status === "Open"} />
        <Suspense fallback={<MarketSkeleton />}>
          <MarketBody claim={claim} recorded={recorded} side={side} />
        </Suspense>
      </div>
    </main>
  );
}
