import Link from "next/link";
import { StateBox } from "@/components/States";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main id="main" className="wrap" style={{ paddingTop: 32 }}>
      <StateBox icon="search" title="There’s no fact here"
        actions={<><Link className="btn primary" href="/#facts">See every live fact</Link><Link className="btn soft" href="/c/18?recorded=1">Watch a replay</Link></>}>
        This address doesn’t match a fact on the market. It may have a typo, or the fact may not be open yet.
      </StateBox>
    </main>
  );
}
