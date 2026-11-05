// Points isitpriced.com (SITE_DOMAIN) at the Vercel project through Porkbun's API.
//   node scripts/vercel/dns.mjs          show what would change (read-only)
//   node scripts/vercel/dns.mjs --apply  remove the parking ALIAS and wildcard CNAME, then add the records Vercel asks for
// Reads PORKBUN_API_KEY, PORKBUN_SECRET_KEY, SITE_DOMAIN and VERCEL_TOKEN from .env; prints no secret.
import { dotEnv, vercelApi } from "./env.mjs";

const env = dotEnv();
const domain = env.SITE_DOMAIN || "isitpriced.com";
const apply = process.argv.includes("--apply");
const auth = { apikey: env.PORKBUN_API_KEY, secretapikey: env.PORKBUN_SECRET_KEY };
if (!auth.apikey || !auth.secretapikey) throw new Error("PORKBUN_API_KEY and PORKBUN_SECRET_KEY must be set in .env");

async function pb(p, body = {}) {
  const r = await fetch(`https://api.porkbun.com/api/json/v3${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...auth, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (j.status !== "SUCCESS") throw new Error(`porkbun ${p}: ${j.message || r.status}`);
  return j;
}

const v = vercelApi(env);
const cfg = await v.call("GET", `/v6/domains/${domain}/config`);
const wantA = cfg.recommendedIPv4?.[0]?.value || ["76.76.21.21"];
const wantCname = String(cfg.recommendedCNAME?.[0]?.value || "cname.vercel-dns.com.").replace(/\.$/, "");

const { records } = await pb(`/dns/retrieve/${domain}`);
const apex = (r) => r.name === domain;
const www = (r) => r.name === `www.${domain}`;
const remove = records.filter((r) =>
  (apex(r) && (r.type === "ALIAS" || r.type === "CNAME" || r.type === "AAAA" || (r.type === "A" && !wantA.includes(r.content))))
  || (r.name === `*.${domain}` && r.type === "CNAME")
  || (www(r) && ["CNAME", "A", "AAAA", "ALIAS"].includes(r.type) && !(r.type === "CNAME" && r.content === wantCname)));
const haveA = new Set(records.filter((r) => apex(r) && r.type === "A").map((r) => r.content));
const add = [
  ...wantA.filter((ip) => !haveA.has(ip)).map((ip) => ({ type: "A", name: "", content: ip })),
  ...(records.some((r) => www(r) && r.type === "CNAME" && r.content === wantCname) ? [] : [{ type: "CNAME", name: "www", content: wantCname }]),
];
for (const r of remove) console.log(`remove ${r.type} ${r.name} ${r.content}`);
for (const r of add) console.log(`add    ${r.type} ${r.name || "@"} ${r.content}`);
if (!remove.length && !add.length) console.log(`${domain}: DNS already points at Vercel`);
if (!apply) { console.log("(dry run: pass --apply to make these changes)"); process.exit(0); }
for (const r of remove) await pb(`/dns/delete/${domain}/${r.id}`);
for (const r of add) await pb(`/dns/create/${domain}`, { ...r, ttl: "600" });
console.log("applied");
