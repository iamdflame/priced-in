// data/rehearsal-mainnet.json and data/mainnet-public.json are copies of deployments/, kept so the site
// builds on its own. This fails when a copy drifts from the record: run npm run sync:site-data at the root.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const script = path.join(ROOT, "scripts/sync-site-data.mjs");

describe("the site's deployment data", () => {
  // site/ checked out alone has no deployments/ to compare with
  test.skipIf(!fs.existsSync(script))("matches deployments/ (npm run sync:site-data)", () => {
    const r = spawnSync(process.execPath, [script, "--check"], { cwd: ROOT, encoding: "utf8" });
    expect(r.stderr.trim()).toBe("");
    expect(r.status).toBe(0);
  });
});
