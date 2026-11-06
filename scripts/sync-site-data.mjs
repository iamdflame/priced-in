// The site's copies of the deployment records, so site/ builds on its own:
//   site/data/rehearsal-mainnet.json  deployments/rehearsal/mainnet.json, byte for byte (the ?recorded=1 replay)
//   site/data/mainnet-public.json     the public part of deployments/mainnet.json (the /trust page)
//
//   npm run sync:site-data            write both from deployments/
//   npm run sync:site-data -- --check exit 1, naming the file, when a copy differs (site/tests/unit/site-data.test.ts runs this)
//
// scripts/rehearsal/record.mjs runs it after it records mainnet. Run it after an upgrade too.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// What /trust reads; the rest of deployments/mainnet.json (seed trades, swaps, funding) stays out of the bundle.
const PUBLIC_KEYS = ["network", "root", "accounts", "code", "deployed_at", "verified_at", "keys", "models", "upgrades", "checker"];

/** { "site/data/<file>": exact file contents } as they should be, from deployments/. */
export function siteData(root = ROOT) {
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
  const dep = JSON.parse(read("deployments/mainnet.json"));
  const pub = { note: "Public values from deployments/mainnet.json, for the trust page. Written by npm run sync:site-data; do not edit by hand." };
  for (const k of PUBLIC_KEYS) if (dep[k] !== undefined) pub[k] = dep[k];
  return {
    "site/data/rehearsal-mainnet.json": read("deployments/rehearsal/mainnet.json"),
    "site/data/mainnet-public.json": JSON.stringify(pub, null, 1) + "\n",
  };
}

// A checkout with core.autocrlf turns LF into CRLF: that is not drift.
const lf = (s) => s.replace(/\r\n/g, "\n");

/** The files whose copy differs from what deployments/ gives. */
export function drift(root = ROOT) {
  return Object.entries(siteData(root))
    .filter(([p, want]) => { try { return lf(fs.readFileSync(path.join(root, p), "utf8")) !== lf(want); } catch { return true; } })
    .map(([p]) => p);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const bad = drift();
    if (bad.length) { console.error(`out of date with deployments/: ${bad.join(", ")} (run npm run sync:site-data)`); process.exit(1); }
    console.log("site/data matches deployments/");
  } else {
    for (const [p, body] of Object.entries(siteData())) {
      const file = path.join(ROOT, p);
      const same = fs.existsSync(file) && fs.readFileSync(file, "utf8") === body;
      if (!same) fs.writeFileSync(file, body);
      console.log(`${same ? "unchanged" : "wrote    "} ${p}`);
    }
  }
}
