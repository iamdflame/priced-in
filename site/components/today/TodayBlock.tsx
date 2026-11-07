// Today's claims, the front door while the API has news on and today has lines: the claim people are on
// most, beside you against the AIs; the next few claims as cards; then what is settling next and what was
// just decided. Every count is /api/today's; the AI traders' records are /api/leaderboard's.
import { ClaimCard, ClaimLead } from "./Claim";
import { LineList } from "./Lists";
import { YouPanel } from "./YouPanel";
import { clockUtc, plural } from "@/lib/format";
import type { Fact } from "@/lib/model";
import { arrange, type Today } from "@/lib/news";
import { getBoard } from "@/lib/server/news";

export async function TodayBlock({ today, facts, history, now }: { today: Today; facts: Map<number, Fact>; history: Record<string, [number, number][]>; now: number }) {
  const a = arrange(today.lines, now);
  const board = await getBoard("all");
  const b = board.ok ? board.value : null;
  const questions: Record<number, string> = Object.fromEntries([...[...facts.values()].map((f) => [f.id, f.question] as const), ...today.lines.map((l) => [l.claim_id, l.question] as const)]);
  const c = today.counts;
  const next = today.next_scout_at && today.next_scout_at > now ? `next claims at ${clockUtc(today.next_scout_at)}` : null;
  const counts = [c.today ? `${c.today} new today` : null, c.settling ? `${c.settling} settling` : null, c.decided ? `${c.decided} decided this week` : null, next].filter(Boolean).join(" · ");
  return (
    <section className="today" id="today" aria-labelledby="today-h">
      <div className="today-hd">
        <div>
          <h2 id="today-h">Today’s claims</h2>
          <p>From today’s news, not confirmed yet. Pick free, then come back to see if you called it.</p>
        </div>
        <p className="today-meta">{counts.charAt(0).toUpperCase() + counts.slice(1)}</p>
      </div>
      <div className="today-top">
        {a.lead ? (
          <ClaimLead l={a.lead} f={facts.get(a.lead.claim_id)} now={now} rules={today.rules.picks} />
        ) : (
          <section className="feature tlead quiet" aria-label="No claims open">
            <div className="ftext">
              <h2>No claims are open right now.</h2>
              <p className="payline">{today.next_scout_at && today.next_scout_at > now ? `The next ones open at ${clockUtc(today.next_scout_at)}.` : "New ones open twice a day."} Below: how the last ones were decided.</p>
            </div>
          </section>
        )}
        <YouPanel ai={b?.ai ?? []} board={b?.board ?? []} minSettled={b?.min_settled ?? 5} questions={questions} />
      </div>
      {a.cards.length > 0 && (
        <div className="grid tgrid" data-n={Math.min(4, a.cards.length)}>
          {a.cards.map((l) => <ClaimCard key={l.claim_id} l={l} f={facts.get(l.claim_id)} now={now} points={history[String(l.claim_id)]} />)}
        </div>
      )}
      {(a.next.length > 0 || a.decided.length > 0) && (
        <div className="tlists">
          <LineList id="t-next" title="Settling next" sub={`${plural(a.next.length, "claim")}, soonest first. Waiting ones show why.`} lines={a.next} now={now} />
          <LineList id="t-done" title="Just decided" sub="Settled on-chain by three AI judges, from the named source’s own word." lines={a.decided} now={now} />
        </div>
      )}
    </section>
  );
}
