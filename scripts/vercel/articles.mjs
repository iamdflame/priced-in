// api/_data/articles/: the encyclopedia's text for the page API and the page sweep (OFFICIAL_PAGES=1),
// one file a page and an index, from the pinned revisions in corpus/pages/. The functions can't read
// ../corpus once deployed: vercel.json bundles api/_data/**. The same trim as site/scripts/build-pages.mjs.
//   node scripts/vercel/articles.mjs           write them
//   node scripts/vercel/articles.mjs --check   exit 1, naming the file, when a copy differs
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

const FROM = path.join(ROOT, "corpus/pages");
const TO = path.join(ROOT, "api/_data/articles");

export function articles() {
  const files = {};
  const index = [];
  for (const file of fs.readdirSync(FROM).filter((f) => f.endsWith(".json")).sort()) {
    const p = JSON.parse(fs.readFileSync(path.join(FROM, file), "utf8"));
    files[file] = `${JSON.stringify({ slug: p.slug, title: p.title, url: p.url, attribution: p.attribution, licence: p.licence, revisedAt: p.timestamp, sentences: p.sentences.map((s) => ({ section: s.section, text: s.text, opinion: s.class === "opinion" })) })}\n`;
    index.push({ slug: p.slug, title: p.title, sentences: p.sentences.length });
  }
  files["index.json"] = `${JSON.stringify(index, null, 1)}\n`;
  return files;
}

const want = articles();
if (process.argv.includes("--check")) {
  const bad = Object.keys(want).filter((f) => { try { return fs.readFileSync(path.join(TO, f), "utf8") !== want[f]; } catch { return true; } });
  if (bad.length) { console.error(`out of date with corpus/pages: ${bad.join(", ")} (run node scripts/vercel/articles.mjs)`); process.exit(1); }
  console.log("api/_data/articles matches corpus/pages");
} else {
  fs.rmSync(TO, { recursive: true, force: true });
  fs.mkdirSync(TO, { recursive: true });
  for (const [f, body] of Object.entries(want)) fs.writeFileSync(path.join(TO, f), body);
  console.log(`${Object.keys(want).length - 1} pages to api/_data/articles`);
}
