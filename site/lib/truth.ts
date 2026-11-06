// The commands and addresses a developer copies, in one place, so /developers and /agents can't drift.
// The MCP server defaults to a local API and to testnet, so both must be set to reach the live market.
import { REPO_URL, SITE_URL } from "./nav";

const MCP_ENV = `-e PRICEDIN_API_URL=${SITE_URL} -e NEAR_NETWORK=mainnet`;

/** Run from a clone of the repo: the server isn't on npm yet. */
export const MCP_ADD = `claude mcp add pricedin ${MCP_ENV} -- npx -y ./tools/mcp`;
export const MCP_ADD_WITH_KEY = `claude mcp add pricedin ${MCP_ENV} -e NEAR_ACCOUNT_ID=you.near -e NEAR_PRIVATE_KEY=ed25519:… -- npx -y ./tools/mcp`;

export const API_DOCS_URL = `${REPO_URL}/blob/main/docs/API.md`;

export const embedFrame = (id: number) => `<iframe src="${SITE_URL}/embed/${id}" width="420" height="236" style="border:0" title="Is it true? Priced In"></iframe>`;
export const embedScript = (id: number) => `<script src="${SITE_URL}/embed.js" data-fact="${id}" async></script>`;
