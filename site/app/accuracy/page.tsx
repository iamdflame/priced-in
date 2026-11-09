// /accuracy: how often the AI judges are right, how it fails, and how we know. Every number comes from
// site/data/accuracy.json, which npm run sync:site-data writes from the full test runs in deployments/.
// Each test says how to run it again.
import "../styles/pages.css";
import type { Metadata } from "next";
import Link from "next/link";
import data from "@/data/accuracy.json";
import { Code, Kpis, PageHero, SHead, modelMaker } from "@/components/pages/Kit";
import { REPO_URL } from "@/lib/nav";

export const metadata: Metadata = {
  title: "Accuracy",
  description: "How often the AI judges are right, tested on 232 facts we had already checked by hand. Every wrong decision is listed, and every test can be run again.",
};

const pct = (k: number, n: number) => `${Math.round((k / n) * 100)}%`;
const file = (p: string) => `${REPO_URL}/blob/main/${p}`;

// why each wrong ruling happened, in plain words, by corpus id
const WHY: Record<string, string> = {
  "ethereum-0098": "It read “at any time” strictly: top-ups now wait in a queue.",
  "ethereum-0131": "Transactions now set a maximum fee, not a gas price. The AI judges treated the two as the same.",
  "zcash-0004": "It took “sharing its proof-of-work” to mean the same algorithm. Zcash uses a different one.",
  "avalanche-0040": "The sentence needs its article around it. Alone, it reads as if Ethereum itself changed.",
  "tether-0022": "The source names Tether International, not Tether Holdings, and the AI judges held that against the line.",
  "stablecoin-0079": "It read USDT’s rank among all coins as its rank among stablecoins.",
};

const SETS: { key: "honest" | "bare" | "injection" | "forged"; label: string; want: string }[] = [
  { key: "honest", label: "Real receipts, on 10 lines we caught", want: "Ruled false, and they are" },
  { key: "bare", label: "An accusation with no proof, on 10 true lines", want: "Should not rule false" },
  { key: "injection", label: "Evidence that orders a verdict, on 10 true lines", want: "Should not rule false" },
  { key: "forged", label: "A made-up receipt, on 10 true lines", want: "Should not rule false" },
];

const short = (m: string) => modelMaker(m).short;

// the Sentinel's measured sets (deployments/sentinel-test.json), grouped the way a visitor asks
type SentinelSet = keyof typeof data.sentinel.sets;
type SentinelField = "cases" | "our_jury_runner_calls_models" | "sentinel_disputes_if_the_jury_sides_with_the_challenger";
const SENTINEL_ROWS: { label: string; sets: SentinelSet[] }[] = [
  { label: "Real receipts from real sources", sets: ["honest", "honest_live", "honest_rows"] },
  { label: "A made-up page, quote or record", sets: ["forged", "forged_no_record", "fake_quote"] },
  { label: "A real page and the lie, with no quote", sets: ["url_only"] },
  { label: "A real quote that doesn’t support the lie", sets: ["real_quote", "real_data"] },
];
const sum = (sets: SentinelSet[], f: SentinelField) => sets.reduce((n, k) => n + Number(data.sentinel.sets[k][f] ?? 0), 0);

export default function AccuracyPage() {
  const { bench, jury_test: test, ask_ai: ask } = data;
  const s = bench.sources;
  const n = bench.none;
  const web = ask.web;
  const noWeb = ask.no_web;
  return (
    <main id="main" className="wrap pg">
      <PageHero
        live={false}
        kick="Accuracy"
        title={<>When the AI judges decide, they’re right {pct(s.right, s.ruled)} of the time.</>}
        lede={<>We tested the three AI judges on {s.facts} facts we had already checked by hand, with the real sources in front of them. On {s.declined} they couldn’t agree, so they didn’t rule. Here is every number, every mistake, and how to run it again.</>}
      />
      <Kpis
        label="The AI judges on 232 checked facts"
        items={[
          { v: <>{s.right}<i> of {s.ruled}</i></>, l: "rulings right", s: `95% interval ${Math.round(s.interval.lo * 100)}% to ${Math.round(s.interval.hi * 100)}%` },
          { v: String(s.wrong), l: "rulings wrong", s: "each one is listed below" },
          { v: String(s.declined), l: "not ruled", s: "the bond is refunded and the line reopens" },
          { v: <>{n.right}<i> of {n.ruled}</i></>, l: "right with no sources", s: `it ruled on ${s.ruled} with them` },
        ]}
      />

      <section aria-labelledby="test">
        <SHead id="test" title="The test" sub="Two of three models must match, as on the chain. The right answers come from our corpus, checked against primary sources before this test existed." />
        <div className="panel boardwrap">
          <table className="board stack">
            <thead><tr><th scope="col">Who ruled</th><th scope="col" className="n">Right</th><th scope="col" className="n">Wrong</th><th scope="col" className="n">No ruling</th><th scope="col" className="n">Right when it ruled</th></tr></thead>
            <tbody>
              <tr><td><b>The AI judges, with sources</b></td><td className="n" data-l="Right">{s.right}</td><td className="n" data-l="Wrong">{s.wrong}</td><td className="n" data-l="No ruling">{s.declined}</td><td className="n" data-l="Right when it ruled">{pct(s.right, s.ruled)}</td></tr>
              <tr><td>The AI judges, with no sources</td><td className="n" data-l="Right">{n.right}</td><td className="n" data-l="Wrong">{n.wrong}</td><td className="n" data-l="No ruling">{n.declined}</td><td className="n" data-l="Right when it ruled">{pct(n.right, n.ruled)}</td></tr>
              {Object.entries(s.single_models).map(([m, v]) => (
                <tr key={m}><td>{short(m)} alone, with sources</td><td className="n" data-l="Right">{v.right}</td><td className="n" data-l="Wrong">{v.wrong}</td><td className="n" data-l="No ruling">{v.abstained}</td><td className="n" data-l="Right when it ruled">{pct(v.right, v.right + v.wrong)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel cc result-gap">
          <p>On the {s.true_lines.facts} true lines the AI judges decided {s.true_lines.right} true and {s.true_lines.wrong} false. On the {s.false_lines.facts} stale or wrong lines they decided {s.false_lines.right} false and {s.false_lines.wrong} true. Most facts they declined had a short source excerpt that didn’t settle them, which is the right time to say so.</p>
        </div>
      </section>

      <section aria-labelledby="wrong">
        <SHead id="wrong" title="Every wrong ruling" sub="A wrong ruling can be disputed with a bond while its window is open. These would have needed one." />
        <div className="panel boardwrap">
          <table className="board stack">
            <thead><tr><th scope="col">The line</th><th scope="col">Our record</th><th scope="col">The AI judges</th><th scope="col">What happened</th></tr></thead>
            <tbody>
              {bench.wrong_rulings.map((w) => (
                <tr key={w.id}>
                  <td className="last"><b>{w.claim}</b><br /><small>From Wikipedia: {w.article}</small></td>
                  <td data-l="Our record">{w.record === "current" ? "True" : "Out of date"}</td>
                  <td data-l="The AI judges">{w.panel === "TRUE" ? "True" : "False"}</td>
                  <td className="last long" data-l="What happened">{WHY[w.id] ?? "Not reviewed yet."}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="liar">
        <SHead id="liar" title="Can someone lie to the AI judges?" sub="We attacked them ourselves, with the AI judges’ exact request. Two of three models decide." />
        <div className="panel boardwrap">
          <table className="board stack">
            <thead><tr><th scope="col">What the AI judges were given</th><th scope="col">The right result</th><th scope="col" className="n">Ruled false</th></tr></thead>
            <tbody>
              {SETS.map((x) => (
                <tr key={x.key}><td>{x.label}</td><td data-l="The right result">{x.want}</td><td className="n" data-l="Ruled false">{test.sets[x.key].panel_false} of {test.sets[x.key].cases}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel cc result-gap">
          <p>The AI judges ignore accusations and orders, but a made-up receipt fooled them {test.sets.forged.panel_false} times in {test.sets.forged.cases}: an AI can’t tell a real quote from a fake one by reading it. On 10 true lines given what our record found, they decided true on {test.sets.confirmed.panel_true} and never false.</p>
        </div>
      </section>

      <section aria-labelledby="sentinel">
        <SHead id="sentinel" title="So every receipt is checked where it lives" sub="Before our AI judges read a challenge, each cited page is fetched and its exact words looked for, and three attested models read the page against the challenge." />
        <div className="panel boardwrap">
          <table className="board stack">
            <thead><tr><th scope="col">The challenge cited</th><th scope="col" className="n">Lines</th><th scope="col" className="n">Our AI judges read it</th><th scope="col" className="n">The Sentinel disputed</th></tr></thead>
            <tbody>
              {SENTINEL_ROWS.map((r) => {
                const n = sum(r.sets, "cases"), sat = sum(r.sets, "our_jury_runner_calls_models"), disputed = sum(r.sets, "sentinel_disputes_if_the_jury_sides_with_the_challenger");
                return <tr key={r.label}><td>{r.label}</td><td className="n" data-l="Lines">{n}</td><td className="n" data-l="Our AI judges read it">{sat}</td><td className="n" data-l="The Sentinel disputed">{disputed}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="panel cc result-gap">
          <p>A challenge whose receipts fail gets no AI judges from us. Anyone can still run the AI judges themselves, so if a decision rests on receipts that failed, the Sentinel disputes it with its own bond inside the window, and the bond doubles if they dispute back. What it can’t catch is a quote on a site the attacker controls: then the doubling bond and the council at the third dispute are what stop them.</p>
        </div>
      </section>

      <section aria-labelledby="ask">
        <SHead id="ask" title="Can’t I just ask an AI?" sub="Yes, and it’s how you win. We tried it on the 10 lines we caught and 6 we know are true." />
        <div className="panel boardwrap">
          <table className="board stack">
            <thead><tr><th scope="col">Asked</th><th scope="col">On the 10 caught lines</th><th scope="col">On the 6 true lines</th></tr></thead>
            <tbody>
              <tr><td>One AI with web search, one run</td><td data-l="On the 10 caught lines">Found {web.caught.found_the_mistake}, unsure on {web.caught.unsure}, repeated {web.caught.repeated_the_error}</td><td data-l="On the 6 true lines">{web.control.right} right, unsure on {web.control.unsure}, {web.control.wrongly_doubted} wrongly doubted</td></tr>
              <tr><td>Three AIs with no web, 3 runs each</td><td data-l="On the 10 caught lines">Repeated the mistake in {noWeb.caught.repeated_the_error} of {noWeb.caught.answers} answers</td><td data-l="On the 6 true lines">Wrongly doubted {noWeb.control.wrongly_doubted} of {noWeb.control.answers} answers</td></tr>
            </tbody>
          </table>
        </div>
        <div className="panel cc result-gap">
          <p>An AI that searches can find most of these. All {web.still_on_wikipedia.of} were still on Wikipedia on {web.still_on_wikipedia.checked_on}, because nobody is paid to look. A market pays the first person who does, and its answer is public, signed and settled.</p>
        </div>
      </section>

      <section aria-labelledby="live">
        <SHead id="live" title="The live record" sub="These tests are off-chain. The real rulings are public as they happen." />
        <div className="panel cc">
          <p>Every ruling on NEAR mainnet, with each judge’s signed verdict, is on <Link href="/rulings">Results</Link>. How the market’s prices compare with what was decided is on <Link href="/stats#rulings">Stats</Link>.</p>
        </div>
      </section>

      <section aria-labelledby="again">
        <SHead id="again" title="Run it again" sub="Each test is one command with a NEAR AI key. Nothing is signed, nothing is posted and no money moves." />
        <div className="panel rebuild">
          <Code label="The AI judges on every checked fact" copy="node scripts/bench-jury.mjs">{"node scripts/bench-jury.mjs\n# deployments/jury-bench.json"}</Code>
          <Code label="Can someone lie to the AI judges?" copy="node scripts/measure-jury.mjs">{"node scripts/measure-jury.mjs\n# deployments/jury-test.json"}</Code>
          <p className="fine">
            Full results: <a className="link" href={file("deployments/jury-bench.json")} target="_blank" rel="noopener">the AI judges</a>, <a className="link" href={file("deployments/jury-test.json")} target="_blank" rel="noopener">the attacks</a>, <a className="link" href={file("deployments/ask-an-ai-web.json")} target="_blank" rel="noopener">AI with web search</a>, <a className="link" href={file("deployments/ask-an-ai.json")} target="_blank" rel="noopener">AI with no web</a>. Run on {bench.at}, one run each. How the record was built: <a className="link" href={file("corpus/METHOD.md")} target="_blank" rel="noopener">the method</a>, written before the first verdict.
          </p>
        </div>
      </section>
    </main>
  );
}
