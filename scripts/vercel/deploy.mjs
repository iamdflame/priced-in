// Deploys the repo to the pricedin project with the Vercel CLI and the token from .env (never
// printed, never in a URL), from this working tree: no git push is involved.
//   node scripts/vercel/deploy.mjs           a production deployment (isitpriced.com once DNS points here)
//   node scripts/vercel/deploy.mjs --preview a preview deployment
// Before the first deploy: scripts/vercel/keys.mjs, scripts/vercel/secrets.mjs, scripts/vercel/seed.mjs.
import { spawn } from "node:child_process";
import { ROOT, TEAM_SLUG, PROJECT, dotEnv, vercelApi, projectId } from "./env.mjs";

const env = dotEnv();
const v = vercelApi(env);
const pid = await projectId(v);
const prod = !process.argv.includes("--preview");
const args = ["deploy", "--yes", "--scope", TEAM_SLUG, ...(prod ? ["--prod"] : []), "--archive=tgz"];
const child = spawn(process.platform === "win32" ? "vercel.cmd" : "vercel", args, {
  cwd: ROOT,
  shell: process.platform === "win32",
  env: { ...process.env, VERCEL_TOKEN: env.VERCEL_TOKEN, VERCEL_ORG_ID: v.teamId(), VERCEL_PROJECT_ID: pid, VERCEL_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let url = null;
const scrub = (s) => String(s).split(env.VERCEL_TOKEN).join("<token>");
child.stdout.on("data", (d) => { const t = scrub(d); process.stdout.write(t); const m = t.match(/https:\/\/[a-z0-9-]+\.vercel\.app/); if (m) url = m[0]; });
child.stderr.on("data", (d) => process.stderr.write(scrub(d)));
child.on("exit", (code) => {
  if (code === 0) console.log(`\n${PROJECT}: ${prod ? "production" : "preview"} deployment ${url ?? "(see above)"}`);
  process.exit(code ?? 1);
});
