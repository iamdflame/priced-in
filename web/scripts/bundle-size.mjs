// Prints the built bundle's size: every file in dist/assets, raw and gzipped.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist/assets");
const rows = fs.readdirSync(dir).filter((f) => !f.endsWith(".map")).map((f) => {
  const b = fs.readFileSync(path.join(dir, f));
  return { file: f, kb: b.length / 1024, gz: zlib.gzipSync(b, { level: 9 }).length / 1024 };
}).sort((a, b) => b.kb - a.kb);
for (const r of rows) console.log(`${r.file.padEnd(40)} ${r.kb.toFixed(1).padStart(8)} KB  ${r.gz.toFixed(1).padStart(7)} KB gzip`);
const js = rows.filter((r) => r.file.endsWith(".js"));
console.log(`total JS ${js.reduce((n, r) => n + r.kb, 0).toFixed(1)} KB, ${js.reduce((n, r) => n + r.gz, 0).toFixed(1)} KB gzip (${js.length} files)`);
