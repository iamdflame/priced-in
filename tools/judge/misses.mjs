// The judges' known misses, recomputed from the committed test runs and printed with every judge report.
// A report that only says PASS hides what the system gets wrong; these lines are the other half. They are
// facts about the AI judges and the Sentinel, measured before launch, never a check that can pass or fail:
//   deployments/jury-bench.json     232 hand-checked facts, each put to the three judges with its sources
//   deployments/sentinel-test.json  challenges against true lines with forged or misleading evidence
// The same rulings are listed, with why each happened, at https://isitpriced.com/accuracy.
import fs from "node:fs";
import path from "node:path";

const read = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
/** "deepseek-ai/DeepSeek-V4.1-Flash-1017" reads as "DeepSeek-V4.1-Flash". */
const short = (model) => (model.split("/").pop() ?? model).replace(/-\d{4}$/, "");
const SET_WORDS = { forged: "a made-up record", forged_no_record: "a record that doesn't exist", fake_quote: "a quote that isn't on the page", real_quote: "a real quote with a lie around it", url_only: "a link and no quote", real_data: "real data that doesn't say it" };

/**
 * @returns {{ bench: { facts: number, ruled: number, right: number, declined: number, wrong: { id: string, right_answer: string, panel: string, jurors: Record<string, string> }[] },
 *   attacks: { cases: number, disputed: number, undisputed: { set: string, id: string, panel: string, support: string[], note: string }[] } }}
 */
export function knownMisses(root) {
  const rows = read(root, "deployments/jury-bench.json").results.filter((r) => r.set === "sources");
  const ruled = rows.filter((r) => r.panel === "TRUE" || r.panel === "FALSE");
  const wrong = ruled.filter((r) => r.panel !== r.right_answer).map((r) => ({ id: r.id, right_answer: r.right_answer, panel: r.panel, jurors: Object.fromEntries(Object.entries(r.jurors).map(([m, v]) => [short(m), v.verdict])) }));
  // every case where the line is true and the challenger's evidence is forged or misleading
  const attacks = read(root, "deployments/sentinel-test.json").rows.filter((r) => r.line_is === "true");
  const undisputed = attacks.filter((r) => r.sentinel?.act !== "dispute").map((r) => ({ set: r.set, id: r.id, panel: r.panel, support: (r.receipt_check?.support?.answers || []).map((a) => a.answer), note: r.sentinel?.note || "" }));
  return {
    bench: { facts: rows.length, ruled: ruled.length, right: ruled.length - wrong.length, declined: rows.length - ruled.length, wrong },
    attacks: { cases: attacks.length, disputed: attacks.length - undisputed.length, undisputed },
  };
}

/** The lines the judge prints, one per kind of miss. */
export function missLines(m) {
  const w = m.bench.wrong.map((x) => `${x.id} (${x.right_answer.toLowerCase()}, ruled ${x.panel}: ${Object.entries(x.jurors).map(([j, v]) => `${j} ${v}`).join(", ")})`);
  const u = m.attacks.undisputed.map((x) => `${x.id} (${SET_WORDS[x.set] || x.set}${x.support.length ? `: the judges asked whether the source supports it answered ${x.support.join(", ")}` : ""}; a jury that ran anyway ruled it ${x.panel})`);
  return [
    `MISS the judges ruled on ${m.bench.ruled} of ${m.bench.facts} hand-checked facts and declined ${m.bench.declined}; of the ${m.bench.ruled} they were wrong on ${m.bench.wrong.length}: ${w.join("; ") || "none"}`,
    `MISS of ${m.attacks.cases} challenges against true lines with forged or misleading evidence, the Sentinel would dispute ${m.attacks.disputed} and not ${m.attacks.undisputed.length}: ${u.join("; ") || "none"}`,
  ];
}
