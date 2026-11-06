// Price your own claim. The form is the page: paste, read the planner's label and starting estimate,
// then bet on the closest live fact, or take the signed receipt that opens a new market.
import "../styles/pages.css";
import type { Metadata } from "next";
import { PageHero } from "@/components/pages/Kit";
import { NewFact } from "@/components/pages/NewFact";

export const metadata: Metadata = {
  title: "Price your own claim",
  description: "Paste any sentence or X link. Our AI says what can be checked and gives a starting estimate, then bet on the closest live fact.",
};

export default function NewFactPage() {
  return (
    <main id="main" className="wrap pg">
      <PageHero
        live={false}
        kick="Price your own claim"
        title="Is it true? Paste it and find out."
        lede={<>Paste a sentence, a paragraph or an X link. Our AI says <b>what can be checked</b> and how likely it looks, before anyone has bet.</>}
      />
      <NewFact />
    </main>
  );
}
