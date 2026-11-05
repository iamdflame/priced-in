// An in-process stand-in for publish.x.com/oembed. Each post id maps to a behaviour:
// a reply, an HTTP status, a delay, or a number of failures before it answers.

import http from "node:http";

/** An oEmbed reply shaped like X's, with the post body given as HTML. */
export function oembedJson({ id, user = "alice", name = "Alice Example", lang = "en", body, date = "November 5, 2026" }) {
  return {
    url: `https://x.com/${user}/status/${id}`,
    author_name: name,
    author_url: `https://x.com/${user}`,
    html: `<blockquote class="twitter-tweet"><p lang="${lang}" dir="ltr">${body}</p>&mdash; ${name} (@${user}) <a href="https://x.com/${user}/status/${id}?ref_src=twsrc%5Etfw">${date}</a></blockquote>\n\n`,
    width: 550,
    height: null,
    type: "rich",
    cache_age: "3153600000",
    provider_name: "X",
    provider_url: "https://x.com",
    version: "1.0",
  };
}

/**
 * @param {Record<string, object>} posts id -> { json } | { status, retryAfter? } | { delayMs, json } | { failTimes, failStatus, json } | { raw }
 */
export async function startMockOembed(posts = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const target = u.searchParams.get("url") || "";
    const id = target.match(/\/status\/(\d+)/)?.[1] || null;
    hits.push({ id, target, query: Object.fromEntries(u.searchParams), headers: req.headers, path: u.pathname });
    const p = posts[id];
    const reply = () => {
      if (!p) { res.writeHead(404, { "content-type": "text/html" }); return res.end("<html>Nothing to see here</html>"); }
      if (p.failTimes > 0) { p.failTimes--; res.writeHead(p.failStatus || 500); return res.end("oops"); }
      if (p.status) {
        res.writeHead(p.status, p.retryAfter ? { "retry-after": String(p.retryAfter) } : {});
        return res.end("<html>error</html>");
      }
      if (p.raw !== undefined) { res.writeHead(200, { "content-type": "application/json" }); return res.end(p.raw); }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(p.json));
    };
    if (p?.delayMs) setTimeout(reply, p.delayMs); else reply();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/oembed`;
  return {
    url,
    posts,
    hits,
    hitsFor: (id) => hits.filter((h) => h.id === id).length,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
