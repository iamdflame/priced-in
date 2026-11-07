// The Postgres store (Supabase) against the same contract as the Blob and disk stores, on an in-memory
// Postgres (PGlite): compare-and-swap, chunks, limits, locks, journals across instances, and races.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PgState, JournalDir, PG_DDL, makeState, storeKind, StoreError } from "../../../api/_lib/store.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-pg-"));
async function database() {
  const pg = new PGlite();
  for (const s of PG_DDL) await pg.exec(s);
  let statements = 0;
  const query = async (text, params) => { statements++; return (await pg.query(text, params)).rows; };
  return { pg, query, count: () => statements };
}

test("the Postgres store: compare-and-swap, chunks, limits, locks and journals behave like the Blob and disk stores", async () => {
  const { query } = await database();
  const s = new PgState({ prefix: "state/testnet/m", query });
  assert.equal(await s.getDoc("a.json"), null);
  const etag = await s.putDoc("a.json", { n: 1 });
  await assert.rejects(s.putDoc("a.json", { n: 2 }), /already exists/);
  await assert.rejects(s.putDoc("a.json", { n: 2 }, { etag: '"nope"' }), /precondition/);
  await s.putDoc("a.json", { n: 2 }, { etag });
  assert.deepEqual((await s.getDoc("a.json")).value, { n: 2 });
  const cur = await s.getDoc("a.json");
  const same = await s.getDoc("a.json", { ifNoneMatch: cur.etag });
  assert.deepEqual([same.notModified, same.value], [true, undefined], "an unchanged document comes back without its body");
  await s.updateDoc("a.json", (c) => ({ n: c.n + 1 }));
  assert.equal((await s.getDoc("a.json")).value.n, 3);
  assert.deepEqual(Object.keys((await s.getDoc("a.json")).value), ["n"]);
  await s.putDoc("order.json", { z: 1, a: 2, m: { y: 1, b: 2 } });
  assert.deepEqual(JSON.stringify((await s.getDoc("order.json")).value), '{"z":1,"a":2,"m":{"y":1,"b":2}}', "the bytes come back as written, key order included");

  assert.equal((await s.take("lane", "1.2.3.4", 2)).ok, true);
  assert.deepEqual([(await s.peek("lane", "1.2.3.4", 2)).used, (await s.peek("lane", "1.2.3.4", 2)).remaining], [1, 1]);
  assert.equal((await s.take("lane", "1.2.3.4", 2)).ok, true);
  assert.equal((await s.take("lane", "1.2.3.4", 2)).ok, false);
  const full = await s.peek("lane", "1.2.3.4", 2);
  assert.equal(full.remaining, 0);
  assert.ok(full.retryAfterS > 0);
  await s.release("lane", "1.2.3.4");
  assert.equal((await s.peek("lane", "1.2.3.4", 2)).remaining, 1);

  const lock = await s.acquire("job", { ttlMs: 60_000 });
  assert.equal(await s.acquire("job", { ttlMs: 60_000 }), null);
  await lock.release();
  assert.ok(await s.acquire("job", { ttlMs: 60_000 }));

  const dir = tmp();
  const j = new JournalDir(s, path.join(dir, "data"));
  j.append("events.jsonl", { uid: "a" });
  j.append("ledger.jsonl", { usd: 0.01 });
  await j.flush();
  j.append("events.jsonl", { uid: "b" });
  await j.flush();
  const j2 = new JournalDir(new PgState({ prefix: "state/testnet/m", query }), path.join(dir, "data2"));
  await j2.hydrate();
  assert.deepEqual(j2.read("events.jsonl"), [{ uid: "a" }, { uid: "b" }]);
  assert.deepEqual(j2.read("ledger.jsonl"), [{ usd: 0.01 }]);
  assert.equal(await j2.hydrate(), false, "an unchanged index is not read again");
  j2.append("events.jsonl", { uid: "c" });
  await j2.flush();
  await j.hydrate();
  assert.deepEqual(j.read("events.jsonl").map((r) => r.uid), ["a", "b", "c"], "each instance sees the other's lines once");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the Postgres store: a cold instance rebuilds every journal in one query, and compaction deletes what it merged", async () => {
  const db = await database();
  const s = new PgState({ prefix: "p", query: db.query });
  const dir = tmp();
  const j = new JournalDir(s, path.join(dir, "a"));
  for (let i = 0; i < 30; i++) { j.append("events.jsonl", { i }); await j.flush(); }
  const cold = new PgState({ prefix: "p", query: db.query });
  const before = db.count();
  const jc = new JournalDir(cold, path.join(dir, "b"));
  await jc.hydrate();
  assert.equal(jc.read("events.jsonl").length, 30);
  assert.equal(db.count() - before, 2, "the index, then all 30 chunks at once");
  assert.equal(await jc.compact({ over: 24 }), 1);
  const keys = await s.listKeys();
  assert.equal(keys.chunks.length, 1, "the 30 merged chunks are gone, the merged one stays");
  assert.deepEqual(keys.docs.map((d) => d.name), ["journals/index.json"]);
  const fresh = new JournalDir(new PgState({ prefix: "p", query: db.query }), path.join(dir, "c"));
  await fresh.hydrate();
  assert.deepEqual(fresh.read("events.jsonl").map((r) => r.i), Array.from({ length: 30 }, (_, i) => i));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the Postgres store: instances racing on one document lose no update, and prefixes never mix", async () => {
  const { query } = await database();
  const a = new PgState({ prefix: "state/mainnet/m", query }), b = new PgState({ prefix: "state/mainnet/m", query });
  await a.putDoc("n.json", { n: 0 });
  await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).updateDoc("n.json", (c) => ({ n: c.n + 1 }))));
  assert.equal((await a.getDoc("n.json")).value.n, 8);
  const other = new PgState({ prefix: "state/testnet/m", query });
  assert.equal(await other.getDoc("n.json"), null);
  assert.deepEqual((await other.listKeys()).docs, []);
});

test("the store is chosen by STATE_STORE: postgres needs its URL, and anything else stays on Blob", () => {
  const pgs = makeState({ prefix: "p", env: { STATE_STORE: "postgres", SUPABASE_DB_URL: "postgresql://u:p@localhost:6543/postgres" } });
  assert.ok(pgs instanceof PgState);
  assert.equal(storeKind(pgs), "postgres");
  assert.throws(() => makeState({ prefix: "p", env: { STATE_STORE: "postgres" } }), (e) => e instanceof StoreError && /SUPABASE_DB_URL/.test(e.message));
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
  try {
    assert.equal(storeKind(makeState({ prefix: "p", env: { STATE_STORE: "blob", SUPABASE_DB_URL: "postgresql://x" } })), "blob");
    assert.equal(storeKind(makeState({ prefix: "p", env: {} })), "blob");
  } finally { if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = saved; }
  assert.equal(storeKind(makeState({ prefix: "p", env: { STATE_DIR: tmp(), STATE_STORE: "postgres" } })), "disk", "a local run stays on the disk");
});

test("the migration: a first copy is byte for byte, and a catch-up after the switch keeps what each store should", async () => {
  const { query } = await database();
  const { FsState } = await import("../../../api/_lib/store.mjs");
  const { syncStores } = await import("../../../api/_lib/store-sync.mjs");
  const dir = tmp();
  const prefix = "state/mainnet/m";
  const blob = new FsState({ prefix, dir }); // stands in for the Blob store: the same contract
  const pg = new PgState({ prefix, query });
  const jb = new JournalDir(blob, path.join(dir, "a"));
  jb.append("events.jsonl", { uid: 1 }); await jb.flush();
  jb.append("ledger.jsonl", { usd: 1 }); await jb.flush();
  await blob.putDoc("news/lines.json", { lines: { 39: { question: "Q" } } });
  await blob.putDoc("locks/job.json", { owner: null, until: 0 });
  await blob.putDoc("limits/lane/2026-11-07.json", { a: 1 });
  await blob.putDoc("snapshots/status.json", { at: 1 });

  const first = await syncStores({ src: blob, dst: pg });
  assert.deepEqual(first.counts, { copied: 5, same: 0, caught_up: 0, merged: 0, kept: 0 });
  assert.deepEqual([first.chunks.copied, first.chunks.missing, first.chunks.differ, first.docs.missing], [2, [], 0, []]);
  const jp = new JournalDir(new PgState({ prefix, query }), path.join(dir, "b"));
  await jp.hydrate();
  assert.deepEqual([jp.read("events.jsonl"), jp.read("ledger.jsonl")], [[{ uid: 1 }], [{ usd: 1 }]]);

  // the switch: Postgres is live, and an old instance still wrote to Blob for a moment
  jp.append("events.jsonl", { uid: 2 }); await jp.flush();
  jb.append("events.jsonl", { uid: 3 }); await jb.flush();
  await blob.updateDoc("snapshots/status.json", () => ({ at: 2 }));
  await pg.updateDoc("news/lines.json", (c) => ({ ...c, live: true }));
  await blob.updateDoc("limits/lane/2026-11-07.json", () => ({ a: 5 }));
  await pg.updateDoc("limits/lane/2026-11-07.json", () => ({ a: 2 }));
  await blob.putDoc("locks/news.json", { owner: "x", until: 9 });

  const delta = await syncStores({ src: blob, dst: pg });
  assert.deepEqual(delta.counts, { copied: 1, same: 1, caught_up: 1, merged: 1, kept: 2 });
  assert.deepEqual((await pg.getDoc("snapshots/status.json")).value, { at: 2 }, "changed only in Blob: Blob's wins");
  assert.equal((await pg.getDoc("news/lines.json")).value.live, true, "changed only in Postgres: kept");
  assert.deepEqual((await pg.getDoc("limits/lane/2026-11-07.json")).value, { a: 2 }, "changed in both: Postgres, the live store, keeps its own");
  assert.ok(delta.notes.some((n) => n.startsWith("limits/lane/2026-11-07.json: changed in both")));
  assert.deepEqual((await pg.getDoc("locks/news.json")).value, { owner: "x", until: 9 });
  const fresh = new JournalDir(new PgState({ prefix, query }), path.join(dir, "c"));
  await fresh.hydrate();
  assert.deepEqual(fresh.read("events.jsonl").map((r) => r.uid), [1, 2, 3], "the journal has the live line and the straggler's, each once");
  assert.deepEqual([delta.chunks.missing, delta.chunks.differ, delta.docs.missing], [[], 0, []]);

  const again = await syncStores({ src: blob, dst: pg });
  assert.deepEqual([again.counts.copied, again.counts.caught_up, again.counts.merged], [0, 0, 0], "a second catch-up changes nothing");
  const twice = new JournalDir(new PgState({ prefix, query }), path.join(dir, "d"));
  await twice.hydrate();
  assert.deepEqual(twice.read("events.jsonl").map((r) => r.uid), [1, 2, 3]);
  fs.rmSync(dir, { recursive: true, force: true });
});
