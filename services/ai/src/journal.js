// Append-only JSON lines: the AI layer's persistence. One record per line, written with a
// synchronous append, so a record is either fully on disk or (after a crash mid-write) a torn
// last line, which is cut off on the next open rather than glued to the next record. No native
// module, so it runs the same on Windows and Linux.
//
// Files under the data directory (DATA_DIR):
//   ledger.jsonl      model calls, money intents and their outcomes, agents' last actions
//   rewrites.jsonl    every published rewrite record, provenance bytes included
//   rationales.jsonl  every posted agent rationale
//   personas.jsonl    persona texts registered for strangers' agents
//   signer.jsonl      written only by the signer process: its intents, tx hashes, outcomes

import fs from "node:fs";
import path from "node:path";

export class Journal {
  /** @param {string|null} file null keeps everything in memory (tests) */
  constructor(file) {
    this.file = file || null;
    this.torn = 0;
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      const size = fs.statSync(this.file).size;
      if (size > 0) {
        // a crash mid-append leaves a line without its newline: cut it off
        const fd = fs.openSync(this.file, "r+");
        try {
          const tail = Buffer.alloc(Math.min(size, 1 << 20));
          fs.readSync(fd, tail, 0, tail.length, size - tail.length);
          if (tail[tail.length - 1] !== 0x0a) {
            const nl = tail.lastIndexOf(0x0a);
            const keep = nl < 0 ? size - tail.length : size - tail.length + nl + 1;
            fs.ftruncateSync(fd, keep);
            this.torn++;
          }
        } finally { fs.closeSync(fd); }
      }
    }
  }

  /** Every record, oldest first. A line that does not parse is skipped and counted. */
  read() {
    if (!this.file || !fs.existsSync(this.file)) return [];
    const out = [];
    for (const line of fs.readFileSync(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { this.torn++; }
    }
    return out;
  }

  append(rec) {
    if (!this.file) return;
    fs.appendFileSync(this.file, JSON.stringify(rec) + "\n");
  }

  /** Replace the whole file atomically (compaction). */
  rewrite(recs) {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, recs.map((r) => JSON.stringify(r) + "\n").join(""));
    fs.renameSync(tmp, this.file);
  }
}

/** A journal file in a data directory, or an in-memory one when there is no directory. */
export const journalIn = (dir, name) => new Journal(dir ? path.join(dir, name) : null);
