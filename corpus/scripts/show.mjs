import { readFileSync } from 'node:fs';
for (const slug of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(`corpus/work/${slug}.sentences.json`));
  let sec = '';
  console.log(`=== ${slug}`);
  for (const x of r) {
    if (x.section !== sec) { sec = x.section; console.log(`# ${sec}`); }
    console.log(`${x.id.slice(-3)} ${x.text}`);
  }
}
