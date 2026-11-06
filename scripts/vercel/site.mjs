// The product site (site/) as its own Vercel project in front of the API project. Each step is safe to
// repeat, and `plan` changes nothing. Values from .env and the keys folder are never printed.
//
//   node scripts/vercel/site.mjs plan              what exists, and what the next step would do
//   node scripts/vercel/site.mjs setup             create the project; set its env and the shared PROXY_SECRET on both projects
//   node scripts/vercel/site.mjs deploy            a preview of the committed tree's site/
//   node scripts/vercel/site.mjs deploy --prod     the same, as the project's production deployment
//   node scripts/vercel/site.mjs switch            move isitpriced.com and www to the site project
//   node scripts/vercel/site.mjs rollback          move them back to the API project, as it was before
//
// The API keeps serving at its own alias, API_ORIGIN below, and its crons and jury calls use that alias
// (SELF_URL), so the domain can move in either direction without touching the API. The site forwards
// /api, /health, /claims, /events, /lane, /v1 and /post there, so the same URLs keep answering.
// After `setup`, redeploy the API (node scripts/vercel/deploy.mjs) so it reads PROXY_SECRET.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { ROOT, TEAM_SLUG, PROJECT, dotEnv, vercelApi } from "./env.mjs";

const SITE_PROJECT = "pricedin-site";
const API_ORIGIN = "https://pricedin-fawn.vercel.app";
const DOMAINS = ["isitpriced.com", "www.isitpriced.com"];
const SECRET_FILE = path.join(ROOT, ".apex-test/mainnet/proxy-secret.txt"); // git-ignored

const [cmd = "plan"] = process.argv.slice(2);
const prod = process.argv.includes("--prod");
const env = dotEnv();
const v = vercelApi(env);

const getProject = (name) => v.call("GET", `/v9/projects/${name}`).catch((e) => { if (e.status === 404) return null; throw e; });
const domainsOf = async (id) => ((await v.call("GET", `/v9/projects/${id}/domains`)).domains || []).map((d) => d.name);

/** The shared secret, made once and kept out of git. */
function proxySecret() {
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, "utf8").trim();
  const s = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  fs.writeFileSync(SECRET_FILE, s + "\n", { mode: 0o600 });
  return s;
}

/** Sets one variable for production and preview, creating or updating it. Prints the key only. */
async function setEnv(project, key, value, type) {
  const existing = (await v.call("GET", `/v10/projects/${project.id}/env?decrypt=false`)).envs || [];
  const cur = existing.find((e) => e.key === key);
  const body = { value, type, target: ["production", "preview"] };
  if (cur) await v.call("PATCH", `/v9/projects/${project.id}/env/${cur.id}`, body);
  else await v.call("POST", `/v10/projects/${project.id}/env`, { key, ...body });
  console.log(`${cur ? "updated" : "set"} ${key} on ${project.name} (${type})`);
}

async function plan() {
  const api = await getProject(PROJECT), site = await getProject(SITE_PROJECT);
  console.log(`API project ${PROJECT}: domains ${(await domainsOf(api.id)).join(", ")}`);
  if (!site) { console.log(`site project ${SITE_PROJECT}: not created. Next: setup`); return; }
  const on = await domainsOf(site.id);
  const url = site.targets?.production?.url;
  console.log(`site project ${SITE_PROJECT}: domains ${on.join(", ") || "none"}; production ${url || "none yet"}`);
  console.log(`next: ${!url ? "deploy --prod" : DOMAINS.every((d) => on.includes(d)) ? "nothing: the site serves the domain" : "switch"}`);
}

async function setup() {
  const api = await getProject(PROJECT);
  let site = await getProject(SITE_PROJECT);
  if (!site) {
    site = await v.call("POST", "/v11/projects", { name: SITE_PROJECT, framework: "nextjs" });
    console.log(`created project ${SITE_PROJECT}`);
  } else console.log(`project ${SITE_PROJECT} exists`);
  const secret = proxySecret();
  for (const [key, value] of Object.entries({ API_ORIGIN, NEAR_NETWORK: "mainnet", SITE_URL: "https://isitpriced.com" })) await setEnv(site, key, value, "plain");
  await setEnv(site, "PROXY_SECRET", secret, "encrypted");
  await setEnv(api, "PROXY_SECRET", secret, "encrypted");
  console.log("next: redeploy the API with node scripts/vercel/deploy.mjs, so it reads PROXY_SECRET");
}

/** Uploads site/ from a clean copy of the committed tree: nothing untracked, no .env. */
async function deploy() {
  const site = await getProject(SITE_PROJECT);
  if (!site) throw new Error("run setup first");
  const stage = path.join(os.tmpdir(), `pricedin-site-${Date.now()}`);
  execFileSync("git", ["worktree", "add", "--detach", stage, "HEAD"], { cwd: ROOT, stdio: "ignore" });
  const cleanup = () => { try { execFileSync("git", ["worktree", "remove", "--force", stage], { cwd: ROOT, stdio: "ignore" }); } catch { fs.rmSync(stage, { recursive: true, force: true }); } };
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
  console.log(`deploying site/ at commit ${commit}${prod ? " to production" : " as a preview"}`);
  const args = ["deploy", "--yes", "--scope", TEAM_SLUG, ...(prod ? ["--prod"] : []), "--meta", `commit=${commit}`];
  const child = spawn(process.platform === "win32" ? "vercel.cmd" : "vercel", args, {
    cwd: path.join(stage, "site"),
    shell: process.platform === "win32",
    env: { ...process.env, VERCEL_TOKEN: env.VERCEL_TOKEN, VERCEL_ORG_ID: v.teamId(), VERCEL_PROJECT_ID: site.id, VERCEL_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const scrub = (s) => String(s).split(env.VERCEL_TOKEN).join("<token>");
  let url = null;
  child.stdout.on("data", (d) => { const t = scrub(d); process.stdout.write(t); const m = t.match(/https:\/\/[a-z0-9-]+\.vercel\.app/); if (m) url = m[0]; });
  child.stderr.on("data", (d) => process.stderr.write(scrub(d)));
  const code = await new Promise((r) => child.on("exit", r));
  cleanup();
  if (code === 0) console.log(`\n${SITE_PROJECT}: ${prod ? "production" : "preview"} ${url ?? "(see above)"} (commit ${commit})`);
  process.exit(code ?? 1);
}

/** Moves the domains to `to`, then checks the site answers there. */
async function move(from, to) {
  const a = await getProject(from), b = await getProject(to);
  if (!a || !b) throw new Error(`need both projects: ${from}, ${to}`);
  if (to === SITE_PROJECT && !b.targets?.production?.url) throw new Error("the site has no production deployment yet: deploy --prod first");
  const on = await domainsOf(a.id);
  for (const name of DOMAINS) {
    if (!on.includes(name)) { console.log(`${name} is not on ${from}`); continue; }
    await v.call("POST", `/v1/projects/${a.id}/domains/${name}/move`, { projectId: b.id });
    console.log(`moved ${name} to ${to}`);
  }
  const r = await fetch("https://isitpriced.com/health", { signal: AbortSignal.timeout(20_000) }).catch((e) => ({ ok: false, status: e.message }));
  console.log(`https://isitpriced.com/health: ${r.status}`);
}

if (cmd === "plan") await plan();
else if (cmd === "setup") await setup();
else if (cmd === "deploy") await deploy();
else if (cmd === "switch") await move(PROJECT, SITE_PROJECT);
else if (cmd === "rollback") await move(SITE_PROJECT, PROJECT);
else { console.error("usage: site.mjs plan | setup | deploy [--prod] | switch | rollback"); process.exit(1); }
