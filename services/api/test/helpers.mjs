import { loadConfig } from "../src/config.mjs";
import { createApp } from "../src/app.mjs";

/** Start the API on a random local port with this environment (always testnet). */
export async function startApi(env, deps = {}) {
  const { config, errors } = loadConfig({ NEAR_NETWORK: "testnet", HOST: "127.0.0.1", PORT: "0", SCAN_INTERVAL_MS: "100", ...env });
  if (errors.length) throw new Error(errors.join("; "));
  const app = createApp(config, { log: () => {}, ...deps });
  const addr = await app.start();
  const base = `http://127.0.0.1:${addr.port}`;
  const req = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json, headers: r.headers };
  };
  return { app, base, req, close: () => app.stop() };
}

/** Read Server-Sent Events from a URL; returns { next(pred, ms), close }. */
export async function sse(url, headers = {}) {
  const ac = new AbortController();
  const res = await fetch(url, { headers, signal: ac.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events = [];
  const waiters = [];
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = { event: "message", data: null, id: null };
          for (const line of raw.split("\n")) {
            if (line.startsWith("event: ")) ev.event = line.slice(7);
            else if (line.startsWith("data: ")) ev.data = JSON.parse(line.slice(6));
            else if (line.startsWith("id: ")) ev.id = line.slice(4);
          }
          if (ev.data === null) continue;
          events.push(ev);
          for (const w of [...waiters]) if (w.pred(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); }
        }
      }
    } catch { /* aborted */ }
  })();
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    events,
    next(pred, ms = 5000) {
      const found = events.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (e) => { clearTimeout(t); resolve(e); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`no matching SSE event within ${ms} ms`)); }, ms);
        waiters.push(w);
      });
    },
    close: () => ac.abort(),
  };
}
