// Any address that matches nothing: a fact that doesn't exist, a page that moved, a typo. The words fit all
// of them, and the ways back lead to the facts, the results and how it works.
import Link from "next/link";
import { StateBox } from "@/components/States";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="wrap">
      <div className="pagegap"><StateBox icon="search" level={1} title="We can’t find that page"
        actions={<><Link className="btn primary" href="/#facts">See every fact</Link><Link className="btn soft" href="/rulings">See the results</Link><Link className="btn soft" href="/how">How it works</Link></>}>
        Nothing lives at this address. It may have a typo, or the page or fact may have moved. Every fact on the market is one tap away.
      </StateBox></div>
    </main>
  );
}
