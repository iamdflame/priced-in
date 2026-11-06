// Builds data/pages/ from corpus/pages/: the encyclopedia's text, trimmed to what /p/[slug] shows, plus
// an index. The site can't read ../corpus once deployed on its own, so the pages are copied in.
// Run: npm run pages
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.resolve(site, "../corpus/pages");
const to = path.join(site, "data/pages");

fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });

const index = [];
for (const file of fs.readdirSync(from).filter((f) => f.endsWith(".json")).sort()) {
  const p = JSON.parse(fs.readFileSync(path.join(from, file), "utf8"));
  const page = {
    slug: p.slug, title: p.title, url: p.url, attribution: p.attribution, revisedAt: p.timestamp,
    sentences: p.sentences.map((s) => ({ section: s.section, text: s.text, opinion: s.class === "opinion" })),
  };
  fs.writeFileSync(path.join(to, file), JSON.stringify(page));
  index.push({ slug: p.slug, title: p.title, sentences: p.sentences.length });
}
fs.writeFileSync(path.join(to, "index.json"), `${JSON.stringify(index, null, 1)}\n`);
console.log(`${index.length} pages to data/pages`);
