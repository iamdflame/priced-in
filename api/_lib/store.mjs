// The hosted runtime's store: a private Vercel Blob store, used three ways.
//
//   docs     small JSON documents updated with compare-and-swap on their ETag (ifMatch): the
//            journal index, locks, per-IP daily limits, the cron's health record
//   chunks   immutable JSON-lines files, one per flush; never overwritten, so any copy is good
//   journals the AI layer's DATA_DIR (ledger, rewrites, rationales, signer, ...): the files are
//            rebuilt in /tmp from their chunks before the code runs, and whatever the code
//            appended is uploaded as a new chunk and added to the index afterwards
//
// The code under services/ keeps its append-only files exactly as it does on a server. Nothing
// here edits a record; a signed rewrite is only ever added, and its anchor on-chain stays the
// source of truth.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { put, get, del } from "@vercel/blob";

const ACCESS = "private";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class StoreError extends Error {}

async function readStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

export class BlobState {
  /** @param {{ prefix: string, token?: string, log?: (m: string) => void }} o */
  constructor({ prefix, token = process.env.BLOB_READ_WRITE_TOKEN, log = () => {} }) {
    if (!token) throw new StoreError("BLOB_READ_WRITE_TOKEN is not set: the store is not connected");
    this.prefix = prefix.replace(/\/+$/, "") + "/";
    this.token = token;
    this.log = log;
    this.chunkCache = new Map(); // immutable chunk path -> Buffer
    this.ops = { gets: 0, puts: 0 };
  }

  key(name) { return this.prefix + name; }

  /** A document and its ETag, or null. `ifNoneMatch` returns { notModified: true } when unchanged. */
  async getDoc(name, { ifNoneMatch } = {}) {
    this.ops.gets++;
    const r = await get(this.key(name), { access: ACCESS, useCache: false, token: this.token, ifNoneMatch });
    if (!r) return null;
    if (r.statusCode === 304) return { notModified: true, etag: r.blob.etag };
    const buf = await readStream(r.stream);
    // a compressed answer carries a weak ETag (W/"..."): the store compares the strong one
    return { value: JSON.parse(buf.toString("utf8")), etag: String(r.blob.etag).replace(/^W\//, "") };
  }

  /** Write a document: create it (etag null; fails if it exists) or replace the version read. */
  async putDoc(name, value, { etag = null } = {}) {
    this.ops.puts++;
    const body = JSON.stringify(value);
    const opts = { access: ACCESS, token: this.token, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 };
    if (etag) opts.ifMatch = etag;
    const r = await put(this.key(name), body, opts);
    return r.etag;
  }

  /**
   * Compare-and-swap: fn(current|undefined) returns the new value, or undefined to leave it.
   * Retries when another writer got there first. Returns { value, changed }.
   */
  async updateDoc(name, fn, { retries = 12 } = {}) {
    for (let i = 0; i <= retries; i++) {
      const cur = await this.getDoc(name);
      const next = await fn(cur ? structuredClone(cur.value) : undefined);
      if (next === undefined) return { value: cur?.value, changed: false };
      try {
        await this.putDoc(name, next, { etag: cur?.etag ?? null });
        return { value: next, changed: true };
      } catch (e) {
        const lost = e?.name === "BlobPreconditionFailedError" || /precondition|already exists|412|409/i.test(String(e?.message));
        if (!lost || i === retries) throw e;
        await sleep(40 + Math.random() * 120 * (i + 1));
      }
    }
    throw new StoreError(`could not update ${name}`);
  }

  /** An immutable chunk. */
  async putChunk(name, buf) {
    this.ops.puts++;
    await put(this.key(name), buf, { access: ACCESS, token: this.token, addRandomSuffix: false, contentType: "application/x-ndjson", cacheControlMaxAge: 31536000 });
    this.chunkCache.set(name, Buffer.from(buf));
  }

  async getChunk(name) {
    const hit = this.chunkCache.get(name);
    if (hit) return hit;
    this.ops.gets++;
    const r = await get(this.key(name), { access: ACCESS, token: this.token });
    if (!r || r.statusCode !== 200) throw new StoreError(`chunk ${name} is missing`);
    const buf = await readStream(r.stream);
    this.chunkCache.set(name, buf);
    return buf;
  }

  async deleteChunks(names) {
    if (names.length) await del(names.map((n) => this.key(n)), { token: this.token }).catch((e) => this.log(`store: delete: ${e.message}`));
  }

  // ---------- locks ----------

  /**
   * A lease: one holder at a time, expiring after ttlMs so a crashed holder never blocks for long.
   * Waits up to waitMs. Returns { release, extend } or null.
   */
  async acquire(name, { ttlMs = 300_000, waitMs = 0, owner = crypto.randomUUID() } = {}) {
    const t0 = Date.now();
    for (;;) {
      const { changed } = await this.updateDoc(`locks/${name}.json`, (cur) => (cur && cur.until > Date.now() && cur.owner !== owner ? undefined : { owner, until: Date.now() + ttlMs, at: new Date().toISOString() }));
      if (changed) {
        return {
          owner,
          extend: (ms = ttlMs) => this.updateDoc(`locks/${name}.json`, (cur) => (cur?.owner === owner ? { ...cur, until: Date.now() + ms } : undefined)),
          release: () => this.updateDoc(`locks/${name}.json`, (cur) => (cur?.owner === owner ? { owner: null, until: 0, released: new Date().toISOString() } : undefined)).catch(() => {}),
        };
      }
      if (Date.now() - t0 >= waitMs) return null;
      await sleep(600 + Math.random() * 400);
    }
  }

  // ---------- per-key daily limits that hold across instances ----------

  /** Take one unit of `scope` for `key` today. { ok, remaining, retryAfterS }. */
  async take(scope, key, limit) {
    const day = new Date().toISOString().slice(0, 10);
    const h = crypto.createHash("sha256").update(`${scope}:${key}`).digest("hex").slice(0, 20);
    let out = null;
    await this.updateDoc(`limits/${scope}/${day}.json`, (cur = {}) => {
      const n = cur[h] || 0;
      if (n >= limit) { out = { ok: false, remaining: 0 }; return undefined; }
      out = { ok: true, remaining: limit - n - 1 };
      return { ...cur, [h]: n + 1 };
    });
    const next = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
    return { ...out, retryAfterS: out.ok ? 0 : Math.ceil((next - Date.now()) / 1000) };
  }

  async release(scope, key) {
    const day = new Date().toISOString().slice(0, 10);
    const h = crypto.createHash("sha256").update(`${scope}:${key}`).digest("hex").slice(0, 20);
    await this.updateDoc(`limits/${scope}/${day}.json`, (cur) => (cur?.[h] > 0 ? { ...cur, [h]: cur[h] - 1 } : undefined)).catch(() => {});
  }

  /** How much of `scope` is left for `key` today, without taking any. { used, remaining, retryAfterS }. */
  async peek(scope, key, limit) {
    const day = new Date().toISOString().slice(0, 10);
    const h = crypto.createHash("sha256").update(`${scope}:${key}`).digest("hex").slice(0, 20);
    const cur = await this.getDoc(`limits/${scope}/${day}.json`);
    const used = Number(cur?.value?.[h] || 0);
    const next = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
    return { used, remaining: Math.max(0, limit - used), retryAfterS: used >= limit ? Math.ceil((next - Date.now()) / 1000) : 0 };
  }
}

/**
 * The same store on the local disk, for local runs and tests (STATE_DIR=<dir>): documents with a
 * content ETag and compare-and-swap, immutable chunks, and the same locks and daily limits. One
 * process at a time; never used on Vercel, where BLOB_READ_WRITE_TOKEN selects the Blob store.
 */
export class FsState extends BlobState {
  constructor({ prefix, dir, log = () => {} }) {
    super({ prefix, token: "local", log });
    this.dir = dir;
  }

  file(name) { return path.join(this.dir, ...this.key(name).split("/")); }

  async getDoc(name, { ifNoneMatch } = {}) {
    this.ops.gets++;
    const f = this.file(name);
    if (!fs.existsSync(f)) return null;
    const buf = fs.readFileSync(f);
    const etag = `"${sha(buf)}"`;
    if (ifNoneMatch && ifNoneMatch === etag) return { notModified: true, etag };
    return { value: JSON.parse(buf.toString("utf8")), etag };
  }

  async putDoc(name, value, { etag = null } = {}) {
    this.ops.puts++;
    const f = this.file(name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const body = Buffer.from(JSON.stringify(value));
    const exists = fs.existsSync(f);
    if (!etag && exists) throw Object.assign(new Error("this blob already exists (precondition)"), { name: "BlobPreconditionFailedError" });
    if (etag && (!exists || `"${sha(fs.readFileSync(f))}"` !== etag)) throw Object.assign(new Error("precondition failed (412)"), { name: "BlobPreconditionFailedError" });
    const tmp = `${f}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, f);
    return `"${sha(body)}"`;
  }

  async putChunk(name, buf) {
    this.ops.puts++;
    const f = this.file(name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, buf);
    this.chunkCache.set(name, Buffer.from(buf));
  }

  async getChunk(name) {
    const hit = this.chunkCache.get(name);
    if (hit) return hit;
    this.ops.gets++;
    const f = this.file(name);
    if (!fs.existsSync(f)) throw new StoreError(`chunk ${name} is missing`);
    const buf = fs.readFileSync(f);
    this.chunkCache.set(name, buf);
    return buf;
  }

  async deleteChunks(names) {
    for (const n of names) fs.rmSync(this.file(n), { force: true });
  }
}

/** The store for this runtime: the local disk when STATE_DIR is set, else the Vercel Blob store. */
export function makeState({ prefix, log = () => {}, env = process.env }) {
  if (env.STATE_DIR) return new FsState({ prefix, dir: env.STATE_DIR, log });
  return new BlobState({ prefix, log });
}

// ---------- journals: DATA_DIR rebuilt from chunks, appends uploaded as new chunks ----------

const INDEX = "journals/index.json";
const isJournal = (f) => f.endsWith(".jsonl");

export class JournalDir {
  /** @param {BlobState} state @param {string} dir */
  constructor(state, dir, { log = () => {} } = {}) {
    this.state = state;
    this.dir = dir;
    this.log = log;
    this.base = new Map(); // file -> { len, sha, chunks: [] }
    this.etag = null;
    this.index = { files: {} };
    this.hydratedAt = 0;
    this.flushing = Promise.resolve();
  }

  /** Rebuild the files from the index. Returns true when anything changed since the last call. */
  async hydrate() {
    const doc = await this.state.getDoc(INDEX, { ifNoneMatch: this.etag || undefined });
    this.hydratedAt = Date.now();
    if (doc?.notModified) return false;
    const index = doc?.value || { files: {} };
    fs.mkdirSync(this.dir, { recursive: true });
    const names = [...new Set(Object.values(index.files).flat())].filter((n) => !this.state.chunkCache.has(n));
    // fetch what this instance has not seen yet, a few at a time
    for (let i = 0; i < names.length; i += 12) await Promise.all(names.slice(i, i + 12).map((n) => this.state.getChunk(n)));
    for (const [file, chunks] of Object.entries(index.files)) {
      const buf = Buffer.concat(chunks.map((n) => this.state.chunkCache.get(n)));
      // lines this instance appended and has not uploaded yet stay, after the store's copy
      const f = path.join(this.dir, file);
      const b = this.base.get(file);
      let tail = Buffer.alloc(0);
      if (b && fs.existsSync(f)) {
        const local = fs.readFileSync(f);
        if (local.length > b.len && sha(local.subarray(0, b.len)) === b.sha) tail = local.subarray(b.len);
      }
      fs.writeFileSync(f, Buffer.concat([buf, tail]));
      this.base.set(file, { len: buf.length, sha: sha(buf), chunks: [...chunks] });
    }
    this.index = index;
    this.etag = doc?.etag ?? null;
    return true;
  }

  /** Whether any journal (or only these) differs from what the store holds. */
  dirty(only = null) {
    if (!fs.existsSync(this.dir)) return false;
    return fs.readdirSync(this.dir).filter(isJournal).filter((f) => !only || only.includes(f)).some((f) => fs.statSync(path.join(this.dir, f)).size !== (this.base.get(f)?.len ?? 0));
  }

  /** Upload what the code appended since hydrate (or the last flush). Serialized. */
  flush({ only = null } = {}) {
    const run = this.flushing.catch(() => {}).then(() => this.flushNow(only));
    this.flushing = run.catch((e) => { this.log(`store: flush failed: ${e.message}`); });
    return run;
  }

  async flushNow(only = null) {
    if (!fs.existsSync(this.dir)) return 0;
    const adds = [];
    for (const file of fs.readdirSync(this.dir).filter(isJournal).filter((f) => !only || only.includes(f))) {
      const buf = fs.readFileSync(path.join(this.dir, file));
      const b = this.base.get(file) || { len: 0, sha: sha(Buffer.alloc(0)), chunks: [] };
      if (buf.length === b.len && sha(buf) === b.sha) continue;
      const appended = buf.length > b.len && sha(buf.subarray(0, b.len)) === b.sha;
      // only whole lines leave this instance; a half-written last line waits for the next flush
      const from = appended ? b.len : 0;
      const end = buf.lastIndexOf(0x0a) + 1;
      if (end <= from) continue;
      const part = buf.subarray(from, end);
      const name = `journals/${file}/${Date.now().toString().padStart(14, "0")}-${crypto.randomBytes(4).toString("hex")}.jsonl`;
      await this.state.putChunk(name, part);
      adds.push({ file, name, replace: !appended, replaced: b.chunks, len: end, sha: sha(buf.subarray(0, end)) });
    }
    if (!adds.length) return 0;
    const { value } = await this.state.updateDoc(INDEX, (cur = { files: {} }) => {
      const files = { ...cur.files };
      for (const a of adds) {
        const list = files[a.file] || [];
        // a file the code rewrote (compaction) replaces the chunks it was built from, and keeps any added since
        files[a.file] = a.replace ? [a.name, ...list.filter((n) => !a.replaced.includes(n))] : [...list, a.name];
      }
      return { ...cur, files, updatedAt: new Date().toISOString() };
    });
    this.index = value;
    for (const a of adds) {
      const prev = this.base.get(a.file);
      this.base.set(a.file, { len: a.len, sha: a.sha, chunks: a.replace ? [a.name] : [...(prev?.chunks || []), a.name] });
    }
    this.etag = null; // our own write changed the index: the next hydrate reads it again
    return adds.length;
  }

  /** Merge files with many chunks into one (run under the job lock). */
  async compact({ over = 24 } = {}) {
    const doc = await this.state.getDoc(INDEX);
    if (!doc) return 0;
    let n = 0;
    for (const [file, chunks] of Object.entries(doc.value.files)) {
      if (chunks.length <= over) continue;
      const buf = Buffer.concat(await Promise.all(chunks.map((c) => this.state.getChunk(c))));
      const name = `journals/${file}/${Date.now().toString().padStart(14, "0")}-c${crypto.randomBytes(4).toString("hex")}.jsonl`;
      await this.state.putChunk(name, buf);
      await this.state.updateDoc(INDEX, (cur) => ({ ...cur, files: { ...cur.files, [file]: [name, ...(cur.files[file] || []).filter((c) => !chunks.includes(c))] } }));
      await this.state.deleteChunks(chunks);
      n++;
    }
    this.etag = null;
    return n;
  }

  /** Every record of one journal, from the local copy. */
  read(file) {
    const f = path.join(this.dir, file);
    if (!fs.existsSync(f)) return [];
    const out = [];
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* a torn line: skipped, as the Journal class does */ }
    }
    return out;
  }

  /** The same records, parsed once per change of the file: for read routes on every request. */
  readCached(file) {
    const f = path.join(this.dir, file);
    let st = null;
    try { st = fs.statSync(f); } catch { return []; }
    const key = `${st.size}:${st.mtimeMs}`;
    this.parsed ||= new Map();
    const hit = this.parsed.get(file);
    if (hit?.key === key) return hit.list;
    const list = this.read(file);
    this.parsed.set(file, { key, list });
    return list;
  }

  append(file, rec) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(path.join(this.dir, file), JSON.stringify(rec) + "\n");
  }
}

function sha(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
