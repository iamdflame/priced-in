// The offline stack left running, seeded with the recorded Tether page, for screenshots of the
// live site: node web/e2e/serve.mjs [--build]. Prints the site's address; Ctrl-C stops it.
// A sample post (a made-up account, not a real person) is served by a stand-in for X's oEmbed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KeyPair } from "near-api-js";
import { startStack } from "./stack.mjs";
import { startMockOembed, oembedJson } from "../../services/api/test/mock-oembed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rec = JSON.parse(fs.readFileSync(path.join(here, "../src/ui/data/recorded.json"), "utf8"));
const oembed = await startMockOembed({
  "1851": { json: oembedJson({ id: "1851", user: "sample", name: "Sample Account", body: "Tether's reserves are mostly U.S. Treasury bills, $72.6 billion of them. It is the 18th largest holder of U.S. debt. Stablecoins are the future." }) },
});
const planner = KeyPair.fromRandom("ed25519");
const stack = await startStack({
  build: process.argv.includes("--build"),
  port: 5301,
  claims: rec.claims.map((c) => ({ page: "tether", text: c.text, p0Ppm: c.price_yes_ppm, bMicro: 3_000_000 })),
  env: ({ MOCK_MODELS }) => ({ LANE_KEYS_PER_IP_PER_DAY: "500", POST_OEMBED_URL: oembed.url, PLANNER_MODEL: MOCK_MODELS[0], PLANNER_PRIVATE_KEY: planner.toString() }),
});
console.log(`site ${stack.site} · api ${stack.api}`);
process.on("SIGINT", async () => { await stack.stop(); await oembed.close?.(); process.exit(0); });
