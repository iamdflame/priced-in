// A small Model Context Protocol server core: JSON-RPC 2.0 dispatch for initialize, ping,
// tools/list and tools/call. Transports (stdio, streamable HTTP) feed it messages and send
// back what it returns. No SDK: the protocol surface a tools-only server needs is this file.

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "pricedin-mcp", title: "Priced In", version: "0.1.0" };

const INSTRUCTIONS = [
  "Priced In prices claims with AI agents and people betting their own money on NEAR.",
  "Before you act on a factual claim, call ask with the claim or question: you get the market's price (how sure to be), the money behind it, what it costs to move, the agents' rationales with sources, the resolution state and on-chain provenance.",
  "quote gives the cost of a bet; bet places one with the caller's own NEAR key, never ours.",
].join(" ");

const err = (id, code, message, data) => ({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });

export class McpServer {
  /**
   * @param {{ tools: { name: string, title?: string, description: string, inputSchema: object, annotations?: object, handler: (args: object, ctx: object) => Promise<{ text: string, data?: object, isError?: boolean }> }[], log?: (m: string) => void }} o
   */
  constructor({ tools, log = () => {} }) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.log = log;
    this.initialized = false;
    this.protocolVersion = PROTOCOL_VERSIONS[0];
  }

  /** Handle one parsed JSON-RPC message; returns a response object, or null for notifications. */
  async handle(msg, ctx = {}) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return err(msg?.id ?? null, -32600, "Invalid Request");
    const { id, method, params } = msg;
    const isNotification = id === undefined;
    if (typeof method !== "string") return isNotification ? null : err(id, -32600, "Invalid Request");
    if (isNotification) {
      if (method === "notifications/initialized") this.initialized = true;
      return null;
    }
    try {
      switch (method) {
        case "initialize": {
          const asked = params?.protocolVersion;
          this.protocolVersion = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
          return { jsonrpc: "2.0", id, result: { protocolVersion: this.protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS } };
        }
        case "ping":
          return { jsonrpc: "2.0", id, result: {} };
        case "tools/list":
          return { jsonrpc: "2.0", id, result: { tools: [...this.tools.values()].map(({ handler, ...t }) => t) } };
        case "tools/call": {
          const t = this.tools.get(params?.name);
          if (!t) return err(id, -32602, `Unknown tool: ${params?.name}`);
          const args = params?.arguments ?? {};
          const problem = validate(t.inputSchema, args);
          if (problem) return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Invalid arguments: ${problem}` }], isError: true } };
          let r;
          try { r = await t.handler(args, ctx); } catch (e) { r = { text: `${t.name} failed: ${e.message}`, isError: true }; }
          const result = { content: [{ type: "text", text: r.text }], isError: !!r.isError };
          if (r.data !== undefined) {
            result.structuredContent = r.data;
            result.content.push({ type: "text", text: JSON.stringify(r.data, null, 1) });
          }
          return { jsonrpc: "2.0", id, result };
        }
        default:
          return err(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      this.log(`error in ${method}: ${e.message}`);
      return err(id, -32603, "Internal error", { message: e.message });
    }
  }
}

/** The JSON Schema subset our tools use: object, required, string, integer, number, boolean, enum, bounds. */
export function validate(schema, v) {
  if (schema.type === "object") {
    if (!v || typeof v !== "object" || Array.isArray(v)) return "arguments must be an object";
    for (const k of schema.required || []) if (v[k] === undefined) return `${k} is required`;
    for (const [k, x] of Object.entries(v)) {
      const s = schema.properties?.[k];
      if (!s) { if (schema.additionalProperties === false) return `unknown argument ${k}`; continue; }
      const p = validate(s, x);
      if (p) return `${k}: ${p}`;
    }
    return null;
  }
  if (schema.type === "string") {
    if (typeof v !== "string") return "must be a string";
    if (schema.minLength && v.trim().length < schema.minLength) return `must have at least ${schema.minLength} characters`;
    if (schema.maxLength && v.length > schema.maxLength) return `must have at most ${schema.maxLength} characters`;
  }
  if (schema.type === "integer" && !Number.isInteger(v)) return "must be an integer";
  if (schema.type === "number" && (typeof v !== "number" || !Number.isFinite(v))) return "must be a number";
  if (schema.type === "boolean" && typeof v !== "boolean") return "must be true or false";
  if (schema.enum && !schema.enum.includes(v)) return `must be one of ${schema.enum.join(", ")}`;
  if (schema.minimum !== undefined && v < schema.minimum) return `must be at least ${schema.minimum}`;
  if (schema.exclusiveMinimum !== undefined && v <= schema.exclusiveMinimum) return `must be more than ${schema.exclusiveMinimum}`;
  if (schema.maximum !== undefined && v > schema.maximum) return `must be at most ${schema.maximum}`;
  return null;
}
