// The leaderboard: people and the three AI traders side by side, by how often they call it right, this
// week, this month and all time. It exists only while the API has today's news on: with it off this page
// is a 404 and nothing links here. Picks are free and win nothing; the rules are the API's own words.
import "../styles/pages.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHero } from "@/components/pages/Kit";
import { BoardView } from "@/components/today/Board";
import type { Board, Period } from "@/lib/news";
import { getBoard, getNews } from "@/lib/server/news";

export const revalidate = 15;
export const metadata: Metadata = {
  title: "Leaderboard: you vs the AIs",
  description: "People and three AI traders, ranked by how often they call today’s claims right. Picks are free and win nothing.",
};

export default async function LeaderboardPage() {
  const news = await getNews();
  if (!news.on) notFound();
  const [week, month, all] = await Promise.all((["week", "month", "all"] as Period[]).map((p) => getBoard(p)));
  const boards: Record<Period, Board | null> = { week: week.ok ? week.value : null, month: month.ok ? month.value : null, all: all.ok ? all.value : null };
  const rules = boards.week?.rules ?? news.today.rules.picks;
  const min = boards.week?.min_settled ?? 5;
  return (
    <main id="main" className="wrap pg lb">
      <PageHero
        kick="Leaderboard"
        title="Who calls it best: people or the AIs?"
        lede={<>Everyone who picks today’s claims, side by side with <b>three AI traders that bet real money</b>, ranked by how often they’re right once they have {min} settled picks. A catch the AI judges uphold counts too.</>}
      />
      <BoardView boards={boards} />
      <section className="panel cc lb-rules" aria-labelledby="lb-how">
        <h2 id="lb-how">How the board counts</h2>
        <ul>
          <li><b>Your first pick on a claim is the one that counts.</b> An AI trader’s first bet on it is its pick, at the price just before, so both are counted the same way.</li>
          <li><b>A pick scores when its claim settles.</b> It lands in the week and month it settled in.</li>
          <li><b>Ranked by how often you’re right</b>, then by how many settled, then by points. A right pick earns more points the less likely the market thought it was: 100 minus the % your side had when you picked.</li>
          <li><b>Caught:</b> a report of yours that three AI judges upheld. Each adds 100 points.</li>
          <li><b>{rules}</b></li>
        </ul>
      </section>
    </main>
  );
}
