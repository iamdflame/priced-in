// Checks 6 to 9: the 1Click dry quote, the measured number, the unit suites and the hosted demo.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ONECLICK = "https://1click.chaindefuser.com/v0";
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

// ---------- 6. a 1Click dry quote, Base USDC -> USDC on NEAR (mainnet API, dry: no money moves) ----------
export async function checkOneClick() {
  const quote = (recipientType) => fetch(`${ONECLICK}/quote`, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100,
      originAsset: BASE_USDC, depositType: "ORIGIN_CHAIN", destinationAsset: NEAR_USDC, amount: "5000000",
      refundTo: "0x1111111111111111111111111111111111111111", refundType: "ORIGIN_CHAIN",
      recipient: "priced-in.near", recipientType, deadline: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  let intents, chain;
  try { [intents, chain] = await Promise.all([quote("INTENTS"), quote("DESTINATION_CHAIN")]); }
  catch (e) { return { status: "SKIP", detail: `1Click API unreachable (${String(e.message).slice(0, 80)})`, see: `curl -X POST ${ONECLICK}/quote` }; }
  const q = intents.body?.quote;
  const cmd = `curl -s -X POST ${ONECLICK}/quote -H 'content-type: application/json' -d '{"dry":true,"swapType":"EXACT_INPUT","slippageTolerance":100,"originAsset":"${BASE_USDC}","depositType":"ORIGIN_CHAIN","destinationAsset":"${NEAR_USDC}","amount":"5000000","refundTo":"0x1111111111111111111111111111111111111111","refundType":"ORIGIN_CHAIN","recipient":"priced-in.near","recipientType":"INTENTS","deadline":"<an ISO time an hour ahead>"}'`;
  if (!q?.amountOut) return { status: "FAIL", detail: `no quote: HTTP ${intents.status} ${JSON.stringify(intents.body).slice(0, 160)}`, see: cmd };
  const direct = chain.body?.quote?.amountOut ? `delivery straight to a NEAR account quotes too (${chain.body.quote.amountOutFormatted})` : `delivery straight to a NEAR account (recipientType DESTINATION_CHAIN, which customRecipientMsg needs) is refused today: "${chain.body?.message ?? chain.status}"`;
  return {
    status: "PASS",
    detail: `$5.00 USDC on Base -> ${q.amountOutFormatted} USDC on NEAR (min ${Number(q.minAmountOut) / 1e6}), about ${q.timeEstimate} s, delivered to a NEAR Intents account, dry: true, no key, no deposit address; ${direct}`,
    see: cmd,
  };
}

// ---------- child processes, quietly ----------
function run(cmd, args, { cwd, timeoutMs = 240_000, env } = {}) {
  return new Promise((resolve) => {
    // npm is a .cmd on Windows, which only a shell runs: pass it one command string there
    const win = process.platform === "win32" && !cmd.endsWith(".exe");
    const child = win ? spawn([cmd, ...args].join(" "), { cwd, env: env || process.env, shell: true, stdio: ["ignore", "pipe", "pipe"] }) : spawn(cmd, args, { cwd, env: env || process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => { child.kill(); out += "\n[judge: timed out]"; }, timeoutMs);
    child.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out: String(e.message) }); });
    child.on("close", (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

// ---------- 7. the measured number ----------
export async function checkCorpus(repo, claim) {
  const r = await run(process.execPath, ["corpus/scripts/check.mjs"], { cwd: repo });
  const m = r.out.match(/(\d+) of (\d+) decided data sentences are stale or wrong: ([\d.]+)%/);
  if (r.code !== 0 || !m) return { status: "FAIL", detail: `npm run corpus:check: ${r.out.trim().split("\n").slice(-2).join(" | ").slice(0, 200)}`, see: "npm run corpus:check" };
  const got = `${m[1]} of ${m[2]}`;
  if (got !== claim) return { status: "FAIL", detail: `the README says ${claim}; the corpus gives ${got}`, see: "npm run corpus:check" };
  return { status: "PASS", detail: `recomputed from corpus/pages/*.json at pinned Wikipedia revisions: ${m[1]} of ${m[2]} decided data sentences are stale or wrong (${m[3]}%), as the README says`, see: "npm run corpus:check, then corpus/MANIFEST.json and corpus/ERRORS.json" };
}

// ---------- 8. the unit suites ----------
export async function checkSuites(repo) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const have = (p) => fs.existsSync(path.join(repo, p));
  const parts = [];
  const missing = [];
  const nodeTest = (out) => {
    const n = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1] ?? NaN);
    return { tests: n("tests"), pass: n("pass"), fail: n("fail") };
  };
  const suites = [
    ["AI", "ai:unit", have("node_modules/near-api-js") && have("node_modules/tweetnacl"), "npm ci", nodeTest],
    ["API", "api:unit", have("node_modules/near-api-js"), "npm ci", nodeTest],
    ["web", "web:test", have("web/node_modules/vitest"), "npm run web:install", (out) => {
      const m = out.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/);
      return m ? { tests: Number(m[3]), pass: Number(m[2]), fail: Number(m[1] || 0) } : { tests: NaN, pass: NaN, fail: NaN };
    }],
  ];
  // one at a time: the suites have timing tests, and the reproducible build is running alongside
  for (const [name, script, ok, install, parse] of suites) {
    if (!ok) { missing.push(`${name} (run ${install})`); continue; }
    const t0 = Date.now();
    const r = await run(npm, ["run", "-s", script], { cwd: repo });
    const c = parse(r.out);
    const failedNames = [...r.out.matchAll(/^\s*(?:✖|×|FAIL)\s+(.{0,90})/gm)].map((m) => m[1].trim()).slice(0, 2);
    parts.push({ name, ...c, code: r.code, s: ((Date.now() - t0) / 1000).toFixed(0), failedNames });
  }
  const txt = parts.map((p) => `${p.name} ${p.pass}/${p.tests} in ${p.s} s`).join(", ");
  const bad = parts.filter((p) => p.code !== 0 || !(p.tests > 0) || p.fail > 0 || p.pass !== p.tests);
  if (bad.length) return { status: "FAIL", detail: `${txt}; failing: ${bad.map((p) => `${p.name} (${p.fail} failed${p.failedNames.length ? ": " + p.failedNames.join("; ") : ""})`).join(", ")}`, see: bad.map((p) => `npm run ${p.name === "AI" ? "ai:unit" : p.name === "API" ? "api:unit" : "web:test"}`).join(" && ") };
  if (missing.length) return { status: "SKIP", detail: `not installed: ${missing.join(", ")}${parts.length ? `; ran ${txt}, all passing` : ""}`, see: "npm ci && npm run web:install, then npm run judge" };
  return { status: "PASS", detail: `${txt}, all passing, no network`, see: "npm run ai:unit · npm run api:unit · npm run web:test" };
}

// ---------- 9. the hosted demo ----------
export async function checkSite(site) {
  const base = site.replace(/\/+$/, "");
  const get = (p) => fetch(base + p, { signal: AbortSignal.timeout(15_000) });
  let h;
  try { h = await get("/health"); } catch (e) { return { status: "FAIL", detail: `${base}/health unreachable: ${String(e.message).slice(0, 100)}`, see: `curl ${base}/health` }; }
  const health = await h.json().catch(() => null);
  if (h.status !== 200) return { status: "FAIL", detail: `${base}/health answered ${h.status}: ${JSON.stringify(health?.reasons ?? health).slice(0, 160)}`, see: `curl ${base}/health` };
  const c = await get("/claims?page=tether").then((r) => r.json()).catch(() => null);
  const claims = Array.isArray(c) ? c : c?.claims || [];
  const priced = claims.filter((x) => Number.isFinite(x.price_yes ?? x.price_yes_ppm));
  if (!priced.length) return { status: "FAIL", detail: `/health is 200, but /claims?page=tether has no priced sentence`, see: `curl '${base}/claims?page=tether'` };
  // the SSE stream: a market event (replayed from the buffer or live) within 30 s
  const t0 = Date.now();
  let got = null;
  try {
    const r = await fetch(base + "/events", { headers: { accept: "text/event-stream" }, signal: AbortSignal.timeout(30_000) });
    const reader = r.body.getReader();
    let buf = "";
    while (!got) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString("utf8");
      for (const frame of buf.split(/\r?\n\r?\n/).slice(0, -1)) {
        const ev = (frame.match(/^event: ?(.*)$/m) || [])[1] || "message";
        if (/^data:/m.test(frame) && !["hello", "ping"].includes(ev)) { got = ev; break; }
      }
      buf = buf.split(/\r?\n\r?\n/).at(-1);
    }
    reader.cancel().catch(() => {});
  } catch { /* timed out */ }
  if (!got) return { status: "FAIL", detail: `/health 200 and ${priced.length} priced sentences, but no market event on /events within 30 s`, see: `curl -N ${base}/events` };
  return { status: "PASS", detail: `${base}: /health 200, ${priced.length} priced sentences on the Tether page, a "${got}" event on the SSE stream after ${((Date.now() - t0) / 1000).toFixed(1)} s`, see: base };
}
