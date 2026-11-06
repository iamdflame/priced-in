// The site's copies of the deployment records, so site/ builds on its own:
//   site/data/rehearsal-mainnet.json  deployments/rehearsal/mainnet.json, byte for byte (the ?recorded=1 replay)
//   site/data/mainnet-public.json     the public part of deployments/mainnet.json (the /trust page)
//   site/data/accuracy.json           the summaries of the jury and AI tests in deployments/ (the /accuracy page)
//
//   npm run sync:site-data            write them all from deployments/
//   npm run sync:site-data -- --check exit 1, naming the file, when a copy differs (site/tests/unit/site-data.test.ts runs this)
//
// scripts/rehearsal/record.mjs runs it after it records mainnet. Run it after an upgrade too.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// What /trust reads; the rest of deployments/mainnet.json (seed trades, swaps, funding) stays out of the bundle.
const PUBLIC_KEYS = ["network", "root", "accounts", "code", "deployed_at", "verified_at", "keys", "models", "upgrades", "checker"];

/** The tests' summaries for /accuracy: the numbers only, with each wrong ruling named. The full runs stay in deployments/. */
export function accuracy(root = ROOT) {
  const json = (p) => { try { return JSON.parse(fs.readFileSync(path.join(root, p), "utf8")); } catch { return null; } };
  const bench = json("deployments/jury-bench.json");
  const test = json("deployments/jury-test.json");
  const noWeb = json("deployments/ask-an-ai.json");
  const web = json("deployments/ask-an-ai-web.json");
  const sentinel = json("deployments/sentinel-test.json");
  const panel = (s) => {
    const t = s.true_lines, f = s.false_lines;
    return { facts: t.facts + f.facts, ruled: t.right + t.wrong + f.right + f.wrong, right: t.right + f.right, wrong: t.wrong + f.wrong, declined: t.no_quorum + f.no_quorum, true_lines: t, false_lines: f, single_models: s.single_models };
  };
  const wilson = (k, n, z = 1.96) => {
    const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
    return { lo: Number((c - h).toFixed(3)), hi: Number((c + h).toFixed(3)) };
  };
  const title = (slug) => json(`corpus/pages/${slug}.json`)?.title ?? slug;
  const text = (id) => json(`corpus/pages/${id.replace(/-\d+$/, "")}.json`)?.sentences.find((s) => s.id === id)?.text ?? "";
  const withSources = bench ? panel(bench.summary.sources) : null;
  return {
    note: "Summaries of the tests in deployments/, for the /accuracy page. Written by npm run sync:site-data; do not edit by hand.",
    bench: bench && {
      at: bench.summary.at.slice(0, 10), models: bench.summary.models,
      sources: { ...withSources, interval: wilson(withSources.right, withSources.ruled) },
      none: panel(bench.summary.none),
      wrong_rulings: bench.results.filter((r) => r.set === "sources" && r.panel !== "NO QUORUM" && r.panel !== r.right_answer)
        .map((r) => ({ id: r.id, article: title(r.id.replace(/-\d+$/, "")), claim: text(r.id), record: r.verdict, panel: r.panel })),
    },
    jury_test: test && { at: test.summary.at.slice(0, 10), sets: test.summary.sets },
    ask_ai: { no_web: noWeb && noWeb.summary, web: web && web.summary },
    sentinel: sentinel && (sentinel.summary ?? null),
  };
}

/** { "site/data/<file>": exact file contents } as they should be, from deployments/. */
export function siteData(root = ROOT) {
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
  const dep = JSON.parse(read("deployments/mainnet.json"));
  const pub = { note: "Public values from deployments/mainnet.json, for the trust page. Written by npm run sync:site-data; do not edit by hand." };
  for (const k of PUBLIC_KEYS) if (dep[k] !== undefined) pub[k] = dep[k];
  return {
    "site/data/rehearsal-mainnet.json": read("deployments/rehearsal/mainnet.json"),
    "site/data/mainnet-public.json": JSON.stringify(pub, null, 1) + "\n",
    "site/data/accuracy.json": JSON.stringify(accuracy(root), null, 1) + "\n",
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
