// Copies one store's documents and chunks into another, checks every byte, and keeps a record of what it
// copied in the destination (Postgres), so a second pass can catch up whatever the old store took during a
// switch. Used by scripts/vercel/pg-migrate.mjs, and tested on an in-memory Postgres.
//
// The rules, per document:
//   - missing in the destination: copied
//   - the same in both: left alone
//   - unchanged in the source since the copy: left alone (the destination has moved on)
//   - changed in the source, unchanged in the destination since the copy: the source's copy wins
//     (an old instance wrote it during the switch)
//   - changed in both: the destination, the live store, keeps its own, except the journal index, which
//     gains the chunks the source added since the copy
// Chunks never change once written, so a missing chunk is simply copied.
import crypto from "node:crypto";

const INDEX = "journals/index.json";
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** The record of what was copied, in the destination's database. */
export const SYNC_DDL = [
  "create table if not exists pricedin.migration (key text primary key, blob_etag text, pg_etag text, body text, at timestamptz not null default now())",
  "alter table pricedin.migration enable row level security",
];

/**
 * @param {{ src: object, dst: import('./store.mjs').PgState, force?: boolean }} o src lists, reads docs and chunks;
 *   dst is a PgState with its tables made
 * @returns {Promise<{ counts: object, notes: string[], chunks: { copied: number, total: number, missing: string[], differ: number }, docs: { total: number, missing: string[] } }>}
 */
export async function syncStores({ src, dst, force = false }) {
  for (const s of SYNC_DDL) await dst.q(s);
  const prefix = dst.prefix;
  const record = new Map((await dst.q("select key, blob_etag, pg_etag, body from pricedin.migration where starts_with(key, $1)", [prefix])).map((r) => [r.key.slice(prefix.length), r]));
  const remember = (name, srcEtag, dstEtag, body) => dst.q(
    "insert into pricedin.migration (key, blob_etag, pg_etag, body) values ($1, $2, $3, $4) on conflict (key) do update set blob_etag = excluded.blob_etag, pg_etag = excluded.pg_etag, body = excluded.body, at = now()",
    [prefix + name, srcEtag, dstEtag, body],
  );

  const sk = await src.listKeys();
  const dk = await dst.listKeys();
  const have = new Set(dk.chunks.map((c) => c.name));
  const missing = sk.chunks.filter((c) => !have.has(c.name));
  for (let i = 0; i < missing.length; i += 8) await Promise.all(missing.slice(i, i + 8).map(async (c) => dst.putChunk(c.name, await src.getChunk(c.name))));

  const counts = { copied: 0, same: 0, caught_up: 0, merged: 0, kept: 0 };
  const notes = [];
  for (const d of sk.docs) {
    let b;
    try { b = await src.getDoc(d.name); } catch (e) { notes.push(`${d.name}: not a JSON document (${String(e.message).slice(0, 60)}), left where it is`); continue; }
    if (!b) continue; // gone since the listing
    const body = JSON.stringify(b.value);
    const cur = await dst.getDoc(d.name);
    const rec = record.get(d.name);
    if (!cur) {
      await remember(d.name, b.etag, await dst.putDoc(d.name, b.value), body);
      counts.copied++;
      continue;
    }
    if (JSON.stringify(cur.value) === body) { if (!rec || rec.blob_etag !== b.etag) await remember(d.name, b.etag, cur.etag, body); counts.same++; continue; }
    if (rec && rec.blob_etag === b.etag) { counts.kept++; continue; }
    if ((rec && rec.pg_etag === cur.etag) || (!rec && force)) {
      await remember(d.name, b.etag, await dst.putDoc(d.name, b.value, { etag: cur.etag }), body);
      counts[rec ? "caught_up" : "copied"]++;
      continue;
    }
    if (rec && d.name === INDEX) {
      const copied = new Set(Object.values(JSON.parse(rec.body).files || {}).flat());
      const fresh = Object.fromEntries(Object.entries(b.value.files || {}).map(([f, names]) => [f, names.filter((n) => !copied.has(n))]).filter(([, names]) => names.length));
      for (const n of Object.values(fresh).flat()) if (!have.has(n) && !missing.some((c) => c.name === n)) await dst.putChunk(n, await src.getChunk(n));
      const { value } = await dst.updateDoc(INDEX, (x = { files: {} }) => {
        const files = { ...x.files };
        for (const [f, names] of Object.entries(fresh)) files[f] = [...(files[f] || []), ...names.filter((n) => !(files[f] || []).includes(n))];
        return { ...x, files, updatedAt: new Date().toISOString() };
      });
      await remember(d.name, b.etag, `"${sha(Buffer.from(JSON.stringify(value)))}"`, body);
      counts.merged++;
      continue;
    }
    notes.push(`${d.name}: ${rec ? "changed in both stores since the copy" : "the destination already holds a different copy"}; the destination keeps its own${rec ? "" : " (--force replaces it)"}`);
    counts.kept++;
  }

  // the check: every chunk byte for byte, every document present
  const after = await dst.listKeys();
  const now = new Set(after.chunks.map((c) => c.name));
  const lost = sk.chunks.filter((c) => !now.has(c.name)).map((c) => c.name);
  let differ = 0;
  for (let i = 0; i < sk.chunks.length; i += 8) {
    const part = sk.chunks.slice(i, i + 8).filter((c) => now.has(c.name));
    const pairs = await Promise.all(part.map(async (c) => [await src.getChunk(c.name), await dst.getChunk(c.name)]));
    differ += pairs.filter(([x, y]) => sha(x) !== sha(y)).length;
  }
  const docNames = new Set(after.docs.map((x) => x.name));
  const skipped = new Set(notes.filter((n) => n.includes(": not a JSON document")).map((n) => n.split(": ")[0]));
  const missingDocs = sk.docs.filter((d) => !docNames.has(d.name) && !skipped.has(d.name)).map((d) => d.name);
  return { counts, notes, chunks: { copied: missing.length, total: sk.chunks.length, missing: lost, differ }, docs: { total: sk.docs.length, missing: missingDocs } };
}
