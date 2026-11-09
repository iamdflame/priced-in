// Swap x.com for isitpriced.com in any post link and you land here: the post's checkable lines, priced.
// The server reads the path and the live facts; the post itself loads in the browser (see PostCheck).
import "../../../styles/pages.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostCheck } from "@/components/pages/PostCheck";
import type { LiveFact } from "@/lib/related";
import { getSite } from "@/lib/server/site";

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const POST_ID = /^\d{1,25}$/;

type Params = { params: Promise<{ user: string; id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { user } = await params;
  return { title: `Fact-check this post by @${user}`, description: "This post’s checkable lines, priced by the market and our AI." };
}

export default async function PostPage({ params }: Params) {
  const { user, id } = await params;
  if (!HANDLE.test(user) || !POST_ID.test(id)) notFound();
  // the live facts, small: each priced line shows its closest one at once, with its odds and the bet
  const site = await getSite();
  const live: LiveFact[] = site.facts.filter((f) => f.status === "open" && f.quotes).map((f) => ({ id: f.id, question: f.question, text: f.text, topic: f.topic, pct: Math.round(f.price * 100), quotes: f.quotes }));
  return (
    <main id="main" className="wrap narrow pg">
      <h1 className="pagetitle">Fact-check this post</h1>
      <div className="postwait"><PostCheck user={user} id={id} live={live} /></div>
    </main>
  );
}
