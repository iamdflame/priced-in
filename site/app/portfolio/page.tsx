// /portfolio. The page itself holds no person's data: facts come from the live market, and what this
// visitor holds is read in the browser, from their wallet's account and this browser's free $1 key.
import type { Metadata } from "next";
import { PortfolioView, type FactMap } from "@/components/money/PortfolioView";
import { getSite } from "@/lib/server/site";

export const metadata: Metadata = { title: "Portfolio", description: "What you hold, what it’s worth and what you can collect." };

export default async function PortfolioPage() {
  const site = await getSite();
  const facts: FactMap = Object.fromEntries(site.facts.map((f) => [f.id, { id: f.id, question: f.question, art: f.art, status: f.chainStatus as FactMap[number]["status"], price: f.price }]));
  return <PortfolioView facts={facts} />;
}
