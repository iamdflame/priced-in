// Swap x.com for isitpriced.com in any post link and you land here: the post's checkable lines, priced.
// The path is the only thing the server reads; the post itself loads in the browser (see PostCheck).
import "../../../styles/pages.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostCheck } from "@/components/pages/PostCheck";

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
  return (
    <main id="main" className="wrap narrow">
      <h1 className="pagetitle">Fact-check this post</h1>
      <PostCheck user={user} id={id} />
    </main>
  );
}
