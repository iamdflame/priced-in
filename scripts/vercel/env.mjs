// Shared by the deploy scripts: the repo's .env (never printed) and the Vercel REST API.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const TEAM_SLUG = "david-praises-projects";
export const PROJECT = "pricedin";

/** KEY=value lines from the repo's .env, merged under the process environment. Values are never logged. */
export function dotEnv(file = path.join(ROOT, ".env")) {
  const out = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return { ...out, ...process.env };
}

/**
 * The truth API's payment variables, from the deployment record and the relayer's key file. Empty
 * until scripts/mainnet/x402.mjs has run: then the API stays on the free tier and answers 429 past it.
 * X402_FACILITATOR_ROUTES=0: the hosted API settles only its own calls, so settlements take turns
 * and are all recorded; nothing outside needs /x402/*.
 */
export function x402Env(dep, relayerKey) {
  const x = dep.x402;
  if (!x || !relayerKey) return { plain: {}, secret: {} };
  if (relayerKey.accountId !== x.relayer) throw new Error(`the relayer key is for ${relayerKey.accountId}, but the deployment records ${x.relayer}`);
  return {
    plain: { X402_PAY_TO: x.pay_to, X402_RELAYER_ACCOUNT_ID: x.relayer, X402_PRICE_MICRO: String(x.price_micro), X402_RPC_URL: x.rpc, X402_FACILITATOR_ROUTES: "0" },
    secret: { X402_RELAYER_PRIVATE_KEY: relayerKey.privateKey },
  };
}

/** The Vercel REST API with the token, scoped to the team. */
export function vercelApi(env) {
  if (!env.VERCEL_TOKEN) throw new Error("VERCEL_TOKEN is not set in .env");
  let teamId = null;
  const call = async (method, p, body) => {
    if (!teamId && !p.startsWith("/v2/teams")) {
      const t = await call("GET", "/v2/teams?limit=50");
      teamId = (t.teams || []).find((x) => x.slug === TEAM_SLUG)?.id;
      if (!teamId) throw new Error(`team ${TEAM_SLUG} is not visible to this token`);
    }
    const url = `https://api.vercel.com${p}${teamId ? `${p.includes("?") ? "&" : "?"}teamId=${teamId}` : ""}`;
    const r = await fetch(url, { method, headers: { authorization: `Bearer ${env.VERCEL_TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
    if (!r.ok) { const e = new Error(`${method} ${p}: HTTP ${r.status} ${JSON.stringify(j.error || j).slice(0, 300)}`); e.status = r.status; e.body = j; throw e; }
    return j;
  };
  return { call, teamId: () => teamId };
}

/** The project's id, by name. */
export async function projectId(v) {
  return (await v.call("GET", `/v9/projects/${PROJECT}`)).id;
}
