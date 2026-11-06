// Regenerates site/tests/vectors/lmsr.json from crates/lmsr (npm run vectors:lmsr at the root).
// Needs cargo; the committed vectors are what judge check 1 and the site's tests read.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = path.join(here, "Cargo.toml");
const home = os.homedir();
const candidates = [process.env.CARGO, "cargo", path.join(home, ".cargo/bin/cargo.exe"), path.join(home, ".cargo/bin/cargo")].filter(Boolean);
let out = null, lastErr = null;
for (const cargo of candidates) {
  try {
    out = execFileSync(cargo, ["run", "--quiet", "--release", "--manifest-path", manifest], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "inherit"] });
    break;
  } catch (e) { lastErr = e; }
}
if (out === null) { console.error(`cargo failed: ${lastErr?.message}`); process.exit(1); }
const json = JSON.parse(out);
const file = path.join(here, "../../../site/tests/vectors/lmsr.json");
fs.writeFileSync(file, JSON.stringify(json, null, 0) + "\n");
const steps = json.markets.reduce((n, m) => n + m.steps.length, 0);
console.log(`wrote ${path.relative(process.cwd(), file)}: ${json.exp_expm1_softplus_sigmoid.length} exp rows, ${json.ln.length} ln rows, ${json.markets.length} markets, ${steps} trades`);
