// Copies the API's state from the Vercel Blob store into Postgres (Supabase), checks every byte, and keeps a
// record of what it copied so a second pass can catch up whatever the old store took during the switch.
// The founder runs this; it changes nothing on the chain. The rules are in api/_lib/store-sync.mjs, tested
// in services/api/test/pgstore.test.mjs.
//
//   node scripts/vercel/pg-migrate.mjs            what it would copy; reads both stores, changes nothing
//   node scripts/vercel/pg-migrate.mjs --apply    makes the tables, copies everything, checks every byte
//   Run --apply again after the deploy with STATE_STORE=postgres: it copies what the Blob store took during the
//   switch, and changes nothing once both agree.
//   options: --prefix state/mainnet/market.isitpriced.near (the hosted API's, from deployments/mainnet.json)
//            --force  on a first copy, replace documents Postgres already holds differently
//
// SUPABASE_DB_URL comes from .env (Supabase: Connect, then "Transaction pooler", port 6543). The Blob store's
// token comes from .env, or else from the API project's settings on Vercel (with VERCEL_TOKEN). Neither is printed.
import fs from "node:fs";
import path from "node:path";
import { ROOT, dotEnv, projectId, vercelApi } from "./env.mjs";
import { BlobState, PgState, PG_DDL } from "../../api/_lib/store.mjs";
import { syncStores } from "../../api/_lib/store-sync.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes("--apply"), FORCE = process.argv.includes("--force");
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/mainnet.json"), "utf8"));
const PREFIX = arg("--prefix", `state/${dep.network}/${dep.accounts.market}`);
const env = dotEnv();
const DB_URL = env.SUPABASE_DB_URL || "";
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

if (!DB_URL && APPLY) { console.error("SUPABASE_DB_URL is not in .env: see .apex/YOUR-STEPS.md"); process.exit(1); }
if (DB_URL && !DB_URL.includes(":6543/")) console.log("note: SUPABASE_DB_URL is not the transaction pooler (port 6543). It works here, but the hosted API needs the pooler.");

async function blobToken() {
  if (env.BLOB_READ_WRITE_TOKEN) return env.BLOB_READ_WRITE_TOKEN;
  const v = vercelApi(env);
  const pid = await projectId(v);
  const e = ((await v.call("GET", `/v10/projects/${pid}/env?decrypt=false`)).envs || []).find((x) => x.key === "BLOB_READ_WRITE_TOKEN" && (x.target || []).includes("production"));
  if (!e) throw new Error("BLOB_READ_WRITE_TOKEN is on neither .env nor the API project");
  return (await v.call("GET", `/v1/projects/${pid}/env/${e.id}`)).value;
}

const blob = new BlobState({ prefix: PREFIX, token: await blobToken() });
const pg = DB_URL ? new PgState({ prefix: PREFIX, url: DB_URL }) : null;
const done = async (code = 0) => { if (pg) await pg.close().catch(() => {}); process.exit(code); };

// ---------- what is there ----------
let ready = false;
if (pg) {
  try { await pg.q("select 1 from pricedin.docs limit 1"); ready = true; } catch (e) {
    if (!/does not exist/.test(String(e.message))) { console.error(`Postgres didn't answer: ${String(e.message).slice(0, 160)}`); await done(1); }
  }
}
const bk = await blob.listKeys();
const pk = ready ? await pg.listKeys() : { docs: [], chunks: [] };
const have = new Set(pk.chunks.map((c) => c.name));
const kinds = Object.entries(bk.docs.reduce((m, d) => { const k = d.name.split("/")[0]; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, n]) => `${k} ${n}`).join(", ");
console.log(`Blob (${PREFIX}): ${bk.docs.length} documents, ${bk.chunks.length} journal chunks (${kb(bk.chunks.reduce((n, c) => n + c.bytes, 0))})`);
console.log(`  documents by kind: ${kinds || "none"}`);
console.log(`Postgres: ${!pg ? "no SUPABASE_DB_URL in .env yet" : ready ? `${pk.docs.length} documents, ${pk.chunks.length} chunks` : "connected, no tables yet"}; chunks to copy: ${bk.chunks.filter((c) => !have.has(c.name)).length}`);
if (!APPLY) { console.log(`plan only: nothing was changed.${pg ? " To copy: node scripts/vercel/pg-migrate.mjs --apply" : ""}`); await done(); }

// ---------- copy, then check ----------
for (const s of PG_DDL) await pg.q(s);
const r = await syncStores({ src: blob, dst: pg, force: FORCE });
const c = r.counts;
console.log(`chunks: ${r.chunks.copied} copied; documents: ${c.copied} copied, ${c.same} already the same, ${c.caught_up} caught up, ${c.merged} merged, ${c.kept} kept as Postgres has them`);
for (const n of r.notes) console.log(`  note: ${n}`);
console.log(`check: ${r.chunks.total - r.chunks.missing.length - r.chunks.differ} of ${r.chunks.total} chunks identical, ${r.docs.total - r.docs.missing.length} of ${r.docs.total} documents present`);
if (r.chunks.missing.length || r.chunks.differ || r.docs.missing.length) {
  console.error(`NOT ready: ${r.chunks.missing.length} chunks missing, ${r.chunks.differ} differ, ${r.docs.missing.length} documents missing (${r.docs.missing.slice(0, 5).join(", ")})`);
  await done(1);
}
const live = String(env.STATE_STORE || "").toLowerCase() === "postgres";
console.log(live ? "caught up. Run this once more a few minutes after the deploy; Blob keeps its last copy as a fallback." : "ready. Next: STATE_STORE=postgres in .env, then secrets.mjs and deploy.mjs, then this again (see .apex/YOUR-STEPS.md).");
await done();
