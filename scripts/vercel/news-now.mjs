// Runs a news job on the hosted API now, so the founder can watch a first run by hand instead of waiting for
// the scout's 06:00 or 18:00 UTC slot. The founder runs this. The cron's secret is read from .env, or else from the
// API project's settings on Vercel (where secrets.mjs made it, with VERCEL_TOKEN), and is never printed.
//
//   node scripts/vercel/news-now.mjs                  the scout, now (once per hour slot: a second run that hour skips)
//   node scripts/vercel/news-now.mjs --job settle     reports, scout, settle or all
//
// The scout opens at most NEWS_PER_DAY lines a day with the money step 18 set aside, exactly as the twice-daily
// run does: same gate, same caps. A run takes up to about 5 minutes; the API answers when it's done.
import { Agent } from "undici";
import { dotEnv, projectId, vercelApi } from "./env.mjs";

const API = "https://pricedin-fawn.vercel.app";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const job = arg("--job", "scout");
if (!["reports", "scout", "settle", "all"].includes(job)) { console.error("--job is one of reports, scout, settle, all"); process.exit(1); }
const env = dotEnv();
async function cronSecret() {
  if (env.CRON_SECRET) return env.CRON_SECRET;
  const v = vercelApi(env);
  const pid = await projectId(v);
  const e = ((await v.call("GET", `/v10/projects/${pid}/env?decrypt=false`)).envs || []).find((x) => x.key === "CRON_SECRET" && (x.target || []).includes("production"));
  if (!e) throw new Error("CRON_SECRET is on neither .env nor the API project: run secrets.mjs first");
  return (await v.call("GET", `/v1/projects/${pid}/env/${e.id}`)).value;
}
const secret = await cronSecret().catch((e) => { console.error(e.message); process.exit(1); });
if (!secret) { console.error("Vercel didn't return the cron's secret"); process.exit(1); }

console.log(`asking the API to run the ${job} now; this can take up to about 5 minutes…`);
const r = await fetch(`${API}/api/news?job=${job}${job === "scout" ? "&force=1" : ""}`, {
  headers: { authorization: `Bearer ${secret}` },
  dispatcher: new Agent({ headersTimeout: 400_000, bodyTimeout: 400_000 }),
}).catch((e) => { console.error(`the API didn't answer: ${e.cause?.code || e.message}`); process.exit(1); });
const body = await r.json().catch(() => null);
if (!r.ok || !body) { console.error(`the API answered ${r.status}: ${JSON.stringify(body).slice(0, 300)}`); process.exit(1); }
if (body.off) { console.log("News is off on the API: NEWS_ENABLED isn't 1 there yet. Run secrets.mjs, then deploy.mjs, then this again."); process.exit(1); }
if (body.ok === false) { console.log(body.note || body.error || "the API said no"); process.exit(1); }

const s = body.scout;
if (s?.skipped) console.log(`scout: skipped, ${s.why}`);
else if (s) {
  console.log(`scout ${s.slot}: ${s.headlines ?? 0} headlines read, ${s.candidates ?? 0} claims proposed, ${s.passed ?? 0} passed every check`);
  for (const o of s.opened || []) console.log(`  opened #${o.claim_id}: ${o.question}\n    https://isitpriced.com/c/${o.claim_id}   https://nearblocks.io/txns/${o.tx}`);
  if (!s.opened?.length) console.log("  nothing opened this run");
  const refused = Object.entries(s.refused || {});
  if (refused.length) console.log(`  turned away: ${refused.map(([k, n]) => `${n} by ${k}`).join(", ")}`);
  for (const e of s.errors || []) console.log(`  error: ${e}`);
  if (s.feeds_failed?.length) console.log(`  feeds that failed: ${s.feeds_failed.length}`);
}
const st = body.settle;
if (st && !st.off) console.log(`settler: looked at ${st.looked?.length ?? 0} lines, challenged ${st.challenged?.length ?? 0}${st.errors?.length ? `, ${st.errors.length} errors` : ""}`);
const sp = body.spend;
console.log(`done in ${Math.round((body.ms || 0) / 1000)} s${sp ? `; model spend today $${Number(sp.spent_usd).toFixed(2)} of $${Number(sp.cap_usd).toFixed(2)}` : ""}`);
console.log("Look: https://isitpriced.com");
