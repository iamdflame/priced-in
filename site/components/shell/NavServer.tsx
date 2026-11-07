// The header and the phone bar, with today's news read once: while the API has it on, the leaderboard
// joins the links and the pick tray is mounted; while it's off, they are exactly as they were.
import { PickTray } from "../today/PickTray";
import { Nav } from "./Nav";
import { PhoneNav } from "./PhoneNav";
import { getNews } from "@/lib/server/news";

export async function NavWithNews() {
  const news = await getNews();
  return (
    <>
      <Nav news={news.on} />
      <PhoneNav news={news.on} />
      {news.on && <PickTray />}
    </>
  );
}
