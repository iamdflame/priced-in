// Prints the judge's JSON report (node tools/judge/judge.mjs --json) as one line per check, and in
// GitHub Actions also as a table on the run's summary page.
//   node tools/judge/ci-summary.mjs judge.json
import fs from "node:fs";

const file = process.argv[2] || "judge.json";
let report;
try { report = JSON.parse(fs.readFileSync(file, "utf8")); }
catch (e) { console.error(`no judge report in ${file}: ${e.message}`); process.exit(1); }
const { checks = [], summary = {} } = report;
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ");
const head = `${checks.length} checks: ${summary.pass} PASS, ${summary.fail} FAIL, ${summary.skip} SKIP in ${summary.seconds} s`;

for (const c of checks) console.log(`${String(c.status).padEnd(4)} ${c.id}. ${c.name}: ${c.detail}${c.see ? ` · see: ${c.see}` : ""}`);
console.log(`\n${head} · commit ${summary.commit} · Node ${summary.node} on ${summary.platform}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [
    `### Judge: ${summary.pass} PASS, ${summary.fail} FAIL, ${summary.skip} SKIP`,
    `Commit \`${summary.commit}\` · ${summary.seconds} s · Node ${summary.node} on ${summary.platform} · mainnet market \`${summary.mainnet}\` · testnet market \`${summary.deployment}\`. The judge holds no key and signs nothing.`,
    "",
    "| # | Check | Result | Detail |",
    "|---|---|---|---|",
    ...checks.map((c) => `| ${c.id} | ${esc(c.name)} | ${c.status} | ${esc(c.detail).slice(0, 500)} |`),
    "",
  ];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n"));
}
process.exitCode = summary.fail ? 1 : 0;
