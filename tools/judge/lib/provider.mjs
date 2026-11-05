// A near-api-js JsonRpcProvider over several endpoints. A request an endpoint refuses with a
// rate limit (HTTP 429, or a -429 error) goes to the next endpoint: the refusal comes before the
// endpoint takes the request, so nothing ran. Every other answer is returned as it is, so a
// contract's refusal is never retried.
import { JsonRpcProvider } from "near-api-js";

export const TESTNET = ["https://test.rpc.fastnear.com", "https://testnet-rpc.intea.rs", "https://rpc.testnet.near.org"];
export const isRateLimit = (e) => e?.cause === 429 || /-429|Rate limits exceeded|Too Many Requests|DEPRECATED/i.test(String(e?.message || e));

export class RotatingProvider extends JsonRpcProvider {
  /** @param {string | string[]} urls one URL, a comma-separated list, or an array */
  constructor(urls = TESTNET) {
    const list = (Array.isArray(urls) ? urls : String(urls).split(",")).map((s) => s.trim()).filter(Boolean);
    super({ url: list[0] });
    this.urls = list;
    this.at = 0;
  }
  next() { this.at = (this.at + 1) % this.urls.length; this.connection.url = this.urls[this.at]; return this.connection.url; }
  async sendJsonRpc(method, params) {
    for (let n = 0; ; n++) {
      try { return await super.sendJsonRpc(method, params); }
      catch (e) {
        if (n >= 4 * this.urls.length || !isRateLimit(e)) throw e;
        this.next();
        await new Promise((r) => setTimeout(r, 800 * (1 + Math.floor(n / this.urls.length))));
      }
    }
  }
}
