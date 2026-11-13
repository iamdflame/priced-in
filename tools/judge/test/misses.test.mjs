// The known misses the judge prints with every report (tools/judge/misses.mjs): the numbers are recomputed
// from the committed test runs, and they are the ones docs/TRUST.md and /accuracy give.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { knownMisses, missLines } from "../misses.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("misses: 142 of 232 facts ruled, 136 right, 6 wrong, each wrong ruling named with its three verdicts", () => {
  const m = knownMisses(REPO);
  assert.deepEqual([m.bench.facts, m.bench.ruled, m.bench.right, m.bench.declined, m.bench.wrong.length], [232, 142, 136, 90, 6]);
  assert.deepEqual(m.bench.wrong.map((w) => w.id).sort(), ["avalanche-0040", "ethereum-0098", "ethereum-0131", "stablecoin-0079", "tether-0022", "zcash-0004"]);
  const all = m.bench.wrong.find((w) => w.id === "ethereum-0131");
  assert.deepEqual([all.right_answer, all.panel, Object.values(all.jurors)], ["FALSE", "TRUE", ["TRUE", "TRUE", "TRUE"]], "the one all three judges got wrong");
  assert.ok(Object.keys(all.jurors).every((j) => !j.includes("/")), "judges are named without their vendor path");
});

test("misses: of 53 challenges with forged or misleading evidence the Sentinel would dispute 52; the one it wouldn't is named", () => {
  const m = knownMisses(REPO);
  assert.deepEqual([m.attacks.cases, m.attacks.disputed, m.attacks.undisputed.length], [53, 52, 1]);
  const u = m.attacks.undisputed[0];
  assert.deepEqual([u.set, u.id, u.panel, u.support], ["real_quote", "prediction-market-0067", "FALSE", ["NO", "NO", "YES"]]);
});

test("misses: two printed lines, each starting MISS, with every id in them", () => {
  const lines = missLines(knownMisses(REPO));
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.startsWith("MISS ")));
  assert.match(lines[0], /ruled on 142 of 232 hand-checked facts and declined 90; of the 142 they were wrong on 6: /);
  assert.match(lines[0], /ethereum-0131 \(false, ruled TRUE: Qwen3\.8-27B TRUE, DeepSeek-V4\.1-Flash TRUE, glm-5\.3-flash TRUE\)/);
  assert.match(lines[1], /^MISS of 53 challenges against true lines with forged or misleading evidence, the Sentinel would dispute 52 and not 1: prediction-market-0067 \(a real quote with a lie around it: the judges asked whether the source supports it answered NO, NO, YES; a jury that ran anyway ruled it FALSE\)$/);
  assert.deepEqual(missLines({ bench: { facts: 3, ruled: 2, right: 2, declined: 1, wrong: [] }, attacks: { cases: 4, disputed: 4, undisputed: [] } }).map((l) => l.slice(-6)), [": none", ": none"]);
});
