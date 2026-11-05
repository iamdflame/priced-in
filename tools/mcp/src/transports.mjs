// MCP transports: stdio (newline-delimited JSON-RPC on stdin/stdout, logs on stderr) and
// streamable HTTP (one endpoint, POST JSON-RPC, JSON replies, sessions by Mcp-Session-Id).

import http from "node:http";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { McpServer } from "./protocol.mjs";

export function serveStdio(makeServer, { input = process.stdin, output = process.stdout, log = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const server = makeServer();
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const write = (o) => output.write(`${JSON.stringify(o)}\n`);
  let chain = Promise.resolve();
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); return; }
    // answer in order, but let a slow tool call not block reading
    chain = chain.then(async () => {
      const msgs = Array.isArray(msg) ? msg : [msg];
      const out = (await Promise.all(msgs.map((m) => server.handle(m)))).filter(Boolean);
      if (out.length) write(Array.isArray(msg) ? out : out[0]);
    }).catch((e) => log(`stdio: ${e.message}`));
  });
  return { server, close: () => rl.close(), done: new Promise((r) => rl.on("close", r)) };
}

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * @param {() => McpServer} makeServer a fresh server per session
 * @param {{ port?: number, host?: string, path?: string, allowedOrigins?: string[], log?: (m: string) => void }} [o]
 */
export async function serveHttp(makeServer, { port = 8788, host = "127.0.0.1", path = "/mcp", allowedOrigins = [], log = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const sessions = new Map();
  const json = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(body === undefined ? undefined : JSON.stringify(body)); };
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== path) return json(res, 404, { error: `MCP is served at ${path}` });
    // DNS-rebinding guard: a browser page may only reach this server from a local origin
    const origin = req.headers.origin;
    if (origin && !LOCAL_ORIGIN.test(origin) && !allowedOrigins.includes(origin)) return json(res, 403, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Origin not allowed" } });
    const sid = req.headers["mcp-session-id"];
    if (req.method === "GET") return json(res, 405, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "This server sends no server-initiated stream; POST requests." } }, { allow: "POST, DELETE" });
    if (req.method === "DELETE") {
      if (!sid || !sessions.has(sid)) return json(res, 404, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Session not found" } });
      sessions.delete(sid);
      return json(res, 200, {});
    }
    if (req.method !== "POST") return json(res, 405, { error: "POST, DELETE" }, { allow: "POST, DELETE" });
    let raw = "";
    let size = 0;
    for await (const c of req) { size += c.length; if (size > 1_000_000) return json(res, 413, { error: "body too large" }); raw += c; }
    let msg;
    try { msg = JSON.parse(raw); } catch { return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
    const msgs = Array.isArray(msg) ? msg : [msg];
    const init = msgs.find((m) => m?.method === "initialize");
    let server, headers = {};
    if (init) {
      const id = randomUUID();
      server = makeServer();
      sessions.set(id, server);
      headers["mcp-session-id"] = id;
      if (sessions.size > 1000) sessions.delete(sessions.keys().next().value);
    } else {
      if (!sid) return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Bad Request: Mcp-Session-Id header is required" } });
      server = sessions.get(sid);
      if (!server) return json(res, 404, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Session not found" } });
    }
    const out = (await Promise.all(msgs.map((m) => server.handle(m, { transport: "http" })))).filter(Boolean);
    if (!out.length) { res.writeHead(202, headers); return res.end(); }
    return json(res, 200, Array.isArray(msg) ? out : out[0], headers);
  });
  await new Promise((r, j) => { srv.once("error", j); srv.listen(port, host, r); });
  const a = srv.address();
  log(`pricedin-mcp: streamable HTTP on http://${a.address}:${a.port}${path}`);
  return { server: srv, url: `http://${a.address === "::" ? "127.0.0.1" : a.address}:${a.port}${path}`, sessions, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }) };
}

export { McpServer };
