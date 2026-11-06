import Link from "next/link";
import { StateBox } from "@/components/States";
import { REPLAY_HREF } from "@/lib/nav";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main id="main" className="wrap">
      <div className="pagegap"><StateBox icon="search" title="There’s no fact here"
        actions={<><Link className="btn primary" href="/#facts">See every live fact</Link><Link className="btn soft" href={REPLAY_HREF}>Watch a replay</Link></>}>
        This address doesn’t match a fact on the market. It may have a typo, or the fact may not be open yet.
      </StateBox></div>
    </main>
  );
}
