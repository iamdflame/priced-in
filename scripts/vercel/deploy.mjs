// Deploys the committed tree (git archive HEAD, so nothing untracked, no .env, no .apex-test keys)
// to the pricedin project with the Vercel CLI and the token from .env (passed in the environment,
// never printed). No git push is involved: Vercel builds the uploaded tree.
//   node scripts/vercel/deploy.mjs           a production deployment
//   node scripts/vercel/deploy.mjs --preview a preview deployment
// Before the first deploy: scripts/vercel/keys.mjs, scripts/vercel/secrets.mjs, scripts/vercel/seed.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { ROOT, TEAM_SLUG, PROJECT, dotEnv, vercelApi, projectId } from "./env.mjs";

const env = dotEnv();
const v = vercelApi(env);
const pid = await projectId(v);
const prod = !process.argv.includes("--preview");

// the committed tree only
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-deploy-"));
const tar = path.join(stage, "..", `${path.basename(stage)}.tar`);
execFileSync("git", ["archive", "--format=tar", "-o", tar, "HEAD"], { cwd: ROOT });
execFileSync("tar", ["-xf", tar.replace(/\\/g, "/"), "-C", stage.replace(/\\/g, "/")], { stdio: "ignore", shell: process.platform === "win32" });
fs.rmSync(tar, { force: true });
for (const bad of [".env", ".apex-test", ".apex"]) if (fs.existsSync(path.join(stage, bad))) throw new Error(`${bad} is in the committed tree: refusing to deploy`);
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
console.log(`deploying commit ${commit} from a clean copy of the committed tree`);

const args = ["deploy", "--yes", "--scope", TEAM_SLUG, ...(prod ? ["--prod"] : []), "--meta", `commit=${commit}`];
const child = spawn(process.platform === "win32" ? "vercel.cmd" : "vercel", args, {
  cwd: stage,
  shell: process.platform === "win32",
  env: { ...process.env, VERCEL_TOKEN: env.VERCEL_TOKEN, VERCEL_ORG_ID: v.teamId(), VERCEL_PROJECT_ID: pid, VERCEL_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let url = null;
const scrub = (s) => String(s).split(env.VERCEL_TOKEN).join("<token>");
child.stdout.on("data", (d) => { const t = scrub(d); process.stdout.write(t); const m = t.match(/https:\/\/[a-z0-9-]+\.vercel\.app/); if (m) url = m[0]; });
child.stderr.on("data", (d) => process.stderr.write(scrub(d)));
child.on("exit", (code) => {
  fs.rmSync(stage, { recursive: true, force: true });
  if (code === 0) console.log(`\n${PROJECT}: ${prod ? "production" : "preview"} deployment ${url ?? "(see above)"} (commit ${commit})`);
  process.exit(code ?? 1);
});
