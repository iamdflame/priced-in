// Live check of the post link: `npm run api:post-smoke`. Reads real public posts through
// X's public oEmbed endpoint (no key) via the API's GET /post. Prints SKIP and exits 0 when
// X can't be reached from here. Planner keys are used only if they are already in the env.

import { startApi } from "./helpers.mjs";

const OEMBED = process.env.POST_OEMBED_URL || "https://publish.x.com/oembed";
const UA = "Mozilla/5.0 (compatible; PricedIn/1.0)";

async function reachable() {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(`${OEMBED}?url=${encodeURIComponent("https://x.com/jack/status/20")}&omit_script=true`, { headers: { "user-agent": UA }, signal: ac.signal });
    await r.body?.cancel();
    if (r.status === 429) return "X is rate-limiting this address";
    return null;
  } catch (e) {
    return `offline: ${ac.signal.aborted ? "no answer within 8 s" : e.cause?.code || e.message}`;
  } finally { clearTimeout(t); }
}

const why = await reachable();
if (why) {
  console.log(`SKIP post smoke: ${why}`);
  process.exit(0);
}

const env = { RPC_URLS: "http://127.0.0.1:9", POST_OEMBED_URL: OEMBED };
for (const k of ["NEARAI_API_KEY", "NEARAI_BASE_URL", "PLANNER_MODEL", "PLANNER_PRIVATE_KEY"]) if (process.env[k]) env[k] = process.env[k];
const api = await startApi(env);
let pass = 0;
let fail = 0;
const check = (ok, name, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

try {
  let t0 = Date.now();
  const a = await api.req("GET", `/post?url=${encodeURIComponent("https://x.com/jack/status/20?s=20&t=abc")}`);
  const ms = Date.now() - t0;
  const p = a.json?.post;
  check(a.status === 200 && a.json.page === "x-20", "GET /post?url=x.com/jack/status/20 opens page x-20", `HTTP ${a.status} in ${ms} ms`);
  check(p?.text === "just setting up my twttr", "the post's text, from the live oEmbed", JSON.stringify(p?.text));
  check(p?.authorName === "jack" && p?.handle === "jack" && p?.url === "https://x.com/jack/status/20", "the author's name and a link to the original", `${p?.authorName} (@${p?.handle}) ${p?.url} · ${p?.date}`);
  check(a.json?.sentences?.length === 1 && ["pricing_soon", "priced", "unfalsifiable", "listed"].includes(a.json.sentences[0].status), "its sentence and status", `${a.json?.sentences?.[0]?.status} · planner ${a.json?.planner}`);

  t0 = Date.now();
  const b = await api.req("GET", "/post/twitter.com/jack/status/20/photo/1");
  check(b.status === 200 && b.json.page === "x-20" && api.app.posts.fetches === 1, "another link form is served from the cache", `${Date.now() - t0} ms, ${api.app.posts.fetches} oEmbed read`);

  const c = await api.req("GET", "/post/https://x.com/i/status/1585341984679469056");
  check(c.status === 200 && c.json.post?.handle === "elonmusk" && c.json.post?.mediaCount >= 1 && !/pic\.(x|twitter)\.com/.test(c.json.post?.text || ""), "an /i/status/ link with a photo: the photo dropped and counted", `${JSON.stringify(c.json.post?.text)} · ${c.json.post?.mediaCount} media`);

  const d = await api.req("GET", "/post/1");
  check(d.status === 410 && d.json.gone === true && d.json.post === undefined, "a post that doesn't exist answers gone, with no text", `HTTP ${d.status} ${d.json?.error?.code}`);

  const e = await api.req("GET", `/post?url=${encodeURIComponent("https://example.com/jack/status/20")}`);
  check(e.status === 400 && e.json.error.code === "not_a_post_link", "a link that isn't a post gets the designed message", e.json?.error?.message);
} finally {
  await api.close();
}
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
