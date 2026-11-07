// The settler's source bar (services/ai/src/sources.js) on what the recorded runs already hold: no
// model, no search, no network. Writes deployments/settle-bar-test.json.
//
// What the runs can show. The baseline's 22 lines that reached a challenge are 9 in
// news-settle-test.json, 9 in news-settle-fresh.json and 4 in news-settle-second-look.json. The first
// is a printed log with no URLs, so its 9 can't be measured: their closest record is the same
// claims in news-settle-test-run3.json, an earlier version of the settler, reported as a proxy and
// never added to the direct count. Corroboration is counted only among the receipts each line
// cited, because the runs kept no page text: a second host the model read and didn't quote is
// invisible here, so a line this strands might not strand live.

import fs from "node:fs";
import { hostOf, settlerBar } from "../services/ai/src/sources.js";

const read = (f) => JSON.parse(fs.readFileSync(`deployments/${f}`, "utf8"));
const reached = (x) => x.pipeline?.outcome !== "UNKNOWN" && x.jury_would_be_called === true;
const ruled = (x) => (x.jury?.panel === "TRUE" || x.jury?.panel === "FALSE" ? x.jury.panel : null);

function measure(rows, o) {
  const lines = rows.filter(reached).map((x) => {
    const b = settlerBar(x.pipeline.receipts, { claim: x.claim, settles: x.settles }, o);
    return { question: x.question, outcome: x.pipeline.outcome, ruling: ruled(x), independent: x.independent?.answer ?? null, matched_independent: x.agrees === true, receipts: x.pipeline.receipts.map((r) => hostOf(r.url)), bar: b.why, passes: b.ok, alone: b.alone };
  });
  const stranded = lines.filter((l) => !l.passes);
  const disagreed = (l) => l.ruling && !l.matched_independent;
  return { reached_before: lines.length, reach_now: lines.length - stranded.length, stranded: stranded.length, matched_before: lines.filter((l) => l.matched_independent).length, matched_lost: stranded.filter((l) => l.matched_independent).length, disagreed_before: lines.filter(disagreed).length, disagreed_stopped: stranded.filter(disagreed).length, no_ruling_stopped: stranded.filter((l) => !l.ruling).length, by: Object.fromEntries(["alone", "corroborated", "one_voice"].map((k) => [k, lines.filter((l) => l.bar === k).length])), lines };
}

const brief = ({ lines, ...m }) => m;
const fresh = read("news-settle-fresh.json").results;
const second = read("news-settle-second-look.json").results;
const final = read("news-settle-test.json").rows;
const finalReached = new Set(final.filter((x) => x.receipt_check === "verified").map((x) => x.question));
const proxy = read("news-settle-test-run3.json").results.filter((x) => finalReached.has(x.question));

const out = {
  at: new Date().toISOString(),
  method: "settlerBar over each recorded line that reached a challenge: its cited receipts, its claim and its settling source. No model, no search, no network. direct: the final runs that kept URLs. proxy: the same claims in an earlier version of the settler, for the 9 lines whose final run kept no URLs. Corroboration is counted only among cited receipts, because the runs kept no page text, so stranded lines may be overcounted.",
  baseline: { reached_a_challenge: 22, measurable_directly: fresh.filter(reached).length + second.filter(reached).length, final_run_without_urls: finalReached.size, proxied: proxy.filter(reached).length },
};
for (const [name, o] of [["tied", { tied: true }], ["as_specified", { tied: false }]]) {
  const direct = measure([...fresh, ...second], o), prox = measure(proxy, o);
  // every one of those 9 ruled in the final run, and matched: the rulings at stake are its, not run3's
  const finalMatched = new Set(final.filter((x) => x.receipt_check === "verified" && x.jury === x.independent).map((x) => x.question));
  const proxyMatchedLost = prox.lines.filter((l) => !l.passes && finalMatched.has(l.question)).length;
  out[name] = { direct, proxy: prox, all_22_estimate: { reached_before: direct.reached_before + prox.reached_before, stranded: direct.stranded + prox.stranded, stranded_share: Number(((direct.stranded + prox.stranded) / (direct.reached_before + prox.reached_before)).toFixed(3)), matched_before: direct.matched_before + finalMatched.size, matched_lost: direct.matched_lost + proxyMatchedLost } };
}
fs.writeFileSync("deployments/settle-bar-test.json", `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out.baseline));
for (const name of ["tied", "as_specified"]) console.log(name, "direct", JSON.stringify(brief(out[name].direct)), "\n  proxy ", JSON.stringify(brief(out[name].proxy)), "\n  all 22", JSON.stringify(out[name].all_22_estimate));
for (const l of out.tied.direct.lines.concat(out.tied.proxy.lines).filter((x) => !x.passes)) console.log("stranded:", l.outcome, l.matched_independent ? "matched" : "unmatched", l.receipts.join(" "), "|", l.question.slice(0, 50));
