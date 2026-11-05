// The paragraph rewrites the AI writer produces, kept in memory for GET /rewrites?page=.
// A rewrite is identified by page, paragraph and version. Its status moves from "template"
// (no model yet) to "unsigned" (the model's text, signature pending) to "signed" (the
// signature verified against the model's attested key), or to "unverified" (it did not).
// A later put of the same id replaces it; the latest version per paragraph is what pages show.

export class RewriteStore {
  constructor({ historyPerParagraph = 20, maxParagraphs = 5000 } = {}) {
    this.historyMax = historyPerParagraph;
    this.maxParagraphs = maxParagraphs;
    this.byKey = new Map(); // `${page}#${paragraph}` -> [records, oldest first]
    this.status = { writer: "off", reason: "no writer is attached to this API" };
  }

  put(rec) {
    const key = `${rec.page}#${rec.paragraph}`;
    let list = this.byKey.get(key);
    if (!list) {
      list = [];
      this.byKey.set(key, list);
      if (this.byKey.size > this.maxParagraphs) this.byKey.delete(this.byKey.keys().next().value);
    }
    const i = list.findIndex((r) => r.id === rec.id);
    if (i >= 0) list[i] = rec;
    else {
      list.push(rec);
      list.sort((a, b) => a.version - b.version);
      if (list.length > this.historyMax) list.shift();
    }
    return rec;
  }

  get(id) {
    for (const list of this.byKey.values()) {
      const r = list.find((x) => x.id === id);
      if (r) return r;
    }
    return null;
  }

  /** The latest rewrite of each paragraph on a page, in paragraph order. */
  byPage(page, { history = false } = {}) {
    const out = [];
    for (const [key, list] of this.byKey) {
      if (!key.startsWith(`${page}#`) || !list.length) continue;
      out.push(history ? { paragraph: list.at(-1).paragraph, latest: list.at(-1), versions: list } : list.at(-1));
    }
    return out.sort((a, b) => (a.paragraph ?? a.latest.paragraph) - (b.paragraph ?? b.latest.paragraph));
  }

  recent(n = 50) {
    const all = [];
    for (const list of this.byKey.values()) if (list.length) all.push(list.at(-1));
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, n);
  }
}
