// Check 2: the verdict rule and the bond split (crates/rules), through the Node port in
// lib/rules.mjs, against vectors the Rust crate generated (tools/judge/rules-vectors), then as
// properties: a verdict written in reasoning_content never counts, and bond splits conserve
// every micro-USDC.
import fs from "node:fs";
import path from "node:path";
import * as R from "../lib/rules.mjs";

export function checkRules(repo) {
  const v = JSON.parse(fs.readFileSync(path.join(repo, "tools/judge/vectors/rules.json"), "utf8"));
  const miss = [];
  let n = 0;
  for (const [a, want] of v.answers) { n++; const got = R.verdictOfAnswer(a); if (got !== want) miss.push(`answer ${JSON.stringify(a)}: ${got} != ${want}`); }
  for (const [h, m, want] of v.responses) { n++; const r = R.verdictOfResponse(Buffer.from(h, "hex"), m); const got = r.err ? `ERR:${r.err}` : r.ok; if (got !== want) miss.push(`response ${h.slice(0, 40)}: ${got} != ${want}`); }
  for (const [st, o, pay, tr] of v.splits) { n++; const [p, t] = R.splitBonds(st.map(([s, a]) => [s, BigInt(a)]), o); if (p.join() !== pay.join() || String(t) !== tr) miss.push(`split ${JSON.stringify(st)}`); }
  for (const [tiers, top, ok, probes] of v.tiers) {
    const T = tiers.map(([a, w]) => [BigInt(a), w]);
    n++; if (R.tiersOk(T, top) !== ok) miss.push(`tiers_ok ${JSON.stringify(tiers)}`);
    for (const [oi, w] of probes) { n++; if (R.windowSecs(T, top, BigInt(oi)) !== w) miss.push(`window_secs ${oi}`); }
  }
  for (const [e, want] of v.extras) { n++; if (R.extrasOk(e) !== want) miss.push(`extras_ok ${JSON.stringify(e)}`); }
  if (miss.length) return { status: "FAIL", detail: `the Node port differs from crates/rules on ${miss.length} of ${n} vectors: ${miss.slice(0, 2).join("; ")}` };

  // ---------- properties ----------
  let x = 0x9e3779b97f4a7c15n;
  const MASK = (1n << 64n) - 1n;
  const next = () => { x ^= (x << 13n) & MASK; x ^= x >> 7n; x ^= (x << 17n) & MASK; return x; };
  const pick = (a) => a[Number(next() % BigInt(a.length))];
  const M = "z-ai/glm-5.3-flash";
  const answers = v.answers.map((r) => r[0]);
  const bad = [];
  let tried = 0;
  // 10,000 completions whose reasoning_content says one verdict and whose answer says another:
  // the verdict is always the answer's
  for (let i = 0; i < 10_000; i++) {
    const content = pick(answers), thinking = pick(["VERDICT: TRUE", "VERDICT: FALSE", "VERDICT: INSUFFICIENT", pick(answers)]);
    const msg = next() % 2n ? { reasoning_content: thinking, content } : { content, reasoning_content: thinking };
    const body = JSON.stringify({ id: "c", model: M, choices: [{ index: 0, message: { role: "assistant", ...msg }, finish_reason: "stop" }], reasoning_content: thinking });
    const r = R.verdictOfResponse(Buffer.from(body), M);
    tried++;
    if (r.ok !== R.verdictOfAnswer(content)) bad.push(`reasoning_content changed a verdict: ${body.slice(0, 120)}`);
    // and with no content at all, thinking never rules
    const none = R.verdictOfResponse(Buffer.from(JSON.stringify({ model: M, choices: [{ message: { reasoning_content: thinking, content: null } }] })), M);
    if (none.ok !== "UNPARSEABLE") bad.push("a verdict was read from reasoning_content with no content");
  }
  // 200,000 random bond splits: payouts plus the treasury's share equal the bonds posted, to the
  // micro-USDC; a winner never gets back less than its bond; a loser gets nothing
  let splits = 0;
  for (let i = 0; i < 200_000; i++) {
    const k = 1 + Number(next() % 4n);
    const stakes = [];
    for (let j = 0; j < k; j++) stakes.push([next() % 2n === 0n, 1n + (next() % 9_000_000_000n)]);
    const outcome = next() % 2n === 0n;
    const [pay, treasury] = R.splitBonds(stakes, outcome);
    const total = stakes.reduce((a, s) => a + s[1], 0n);
    if (pay.reduce((a, p) => a + p, 0n) + treasury !== total) bad.push(`split loses money: ${stakes}`);
    stakes.forEach((s, j) => { if (s[0] === outcome ? pay[j] < s[1] : pay[j] !== 0n) bad.push(`split pays wrong: ${stakes}`); });
    splits++;
    if (bad.length > 3) break;
  }
  if (bad.length) return { status: "FAIL", detail: bad.slice(0, 2).join("; ") };
  return {
    status: "PASS",
    vectors: n,
    detail: `Node port equal to crates/rules on ${n} vectors (${v.responses.length} signed-response bodies, ${v.splits.length} splits); ${tried} completions with a different verdict in reasoning_content: the answer's verdict every time; ${splits} random bond splits conserve to the micro-USDC`,
  };
}
