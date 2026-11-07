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
      // what each journal gained in the source since the copy, by content: the source may have compacted a
      // file (its first chunk is then a merged one holding lines the destination already has), so a file
      // whose list no longer starts with the copied names gains only the bytes after the copied ones
      const before = JSON.parse(rec.body).files || {};
      const fresh = {}, wrote = new Set();
      const read = async (n) => { try { return await dst.getChunk(n); } catch { return src.getChunk(n); } };
      for (const [f, names] of Object.entries(b.value.files || {})) {
        const old = before[f] || [];
        if (old.every((n, i) => names[i] === n)) { if (names.length > old.length) fresh[f] = names.slice(old.length); continue; }
        let copiedBytes, srcBytes;
        try { copiedBytes = Buffer.concat(await Promise.all(old.map(read))); srcBytes = Buffer.concat(await Promise.all(names.map((n) => src.getChunk(n)))); } catch (e) { notes.push(`${f}: compacted in both stores, so what it gained can't be told apart (${String(e.message).slice(0, 60)}); the destination keeps its own`); continue; }
        if (!srcBytes.subarray(0, copiedBytes.length).equals(copiedBytes)) { notes.push(`${f}: the source's journal no longer starts with what was copied; the destination keeps its own`); continue; }
        const tail = srcBytes.subarray(copiedBytes.length);
        if (!tail.length) continue;
        const name = `journals/${f}/${Date.now().toString().padStart(14, "0")}-m${crypto.randomBytes(4).toString("hex")}.jsonl`;
        await dst.putChunk(name, tail);
        wrote.add(name);
        fresh[f] = [name];
      }
      for (const n of Object.values(fresh).flat()) if (!have.has(n) && !missing.some((c) => c.name === n) && !wrote.has(n)) await dst.putChunk(n, await src.getChunk(n));
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

  // every chunk the index names must be here too: the old store, still live, may have written one after the
  // listing above and named it in the index we just copied (seen on the first live copy, 7 Nov 2026)
  const named = async () => [...new Set(Object.values((await dst.getDoc(INDEX))?.value?.files || {}).flat())];
  const present = new Set((await dst.listKeys()).chunks.map((c) => c.name));
  const late = (await named()).filter((n) => !present.has(n));
  for (const n of late) await dst.putChunk(n, await src.getChunk(n));

  // the check: every chunk byte for byte, every document present, every chunk the index names present
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
  const dangling = (await named()).filter((n) => !now.has(n));

  // the journals, by content: after the switch the destination compacts its own files, so a source chunk can
  // be gone by name while its lines live on inside a merged one. What counts is that every line the source
  // holds is in the destination, and that the destination repeats none.
  const journal = async (store) => {
    const files = (await store.getDoc(INDEX))?.value?.files || {};
    const out = {};
    for (const [f, names] of Object.entries(files)) {
      const text = Buffer.concat(await Promise.all(names.map((n) => store.getChunk(n)))).toString("utf8");
      out[f] = text.split("\n").filter((l) => l.trim()).reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
    }
    return out;
  };
  const [sj, dj] = await Promise.all([journal(src), journal(dst)]);
  const journals = { files: Object.keys(sj).length, missing_lines: 0, repeated_lines: 0, by_file: {} };
  for (const [f, lines] of Object.entries(sj)) {
    const d = dj[f] || new Map();
    let miss = 0, rep = 0;
    for (const [l, n] of lines) if ((d.get(l) || 0) < n) miss += n - (d.get(l) || 0);
    for (const [l, n] of d) if (n > Math.max(lines.get(l) || 0, 1)) rep += n - Math.max(lines.get(l) || 0, 1);
    journals.missing_lines += miss;
    journals.repeated_lines += rep;
    if (miss || rep) journals.by_file[f] = { missing: miss, repeated: rep };
  }
  return { counts, notes, chunks: { copied: missing.length + late.length, late: late.length, total: sk.chunks.length, missing: lost, differ, dangling }, docs: { total: sk.docs.length, missing: missingDocs }, journals };
}
