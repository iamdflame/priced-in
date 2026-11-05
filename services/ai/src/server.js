// Entry point: `npm run ai`. The API plus the AI layer, in one process (the agents' keys stay
// in a separate signer process). `npm run api` still runs the API alone.

import { loadAiConfig, describeAi } from "./config.js";
import { describeConfig } from "../../api/src/config.mjs";
import { createApp } from "../../api/src/app.mjs";
import { mountAi } from "./mount.js";

const { api, ai, errors, warnings } = loadAiConfig(process.env);
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`config error: ${e}`);
  process.exit(1);
}
const app = createApp(api);
try {
  mountAi(app, ai);
} catch (e) {
  console.error(`startup failed: ${/key/i.test(e.message) ? "JURY_PRIVATE_KEY is malformed" : e.message}`);
  process.exit(1);
}
const addr = await app.start();
console.log(`Priced In API + AI on port ${addr.port}`);
console.log(JSON.stringify({ ...describeConfig(api), ai: describeAi(ai) }));
const shutdown = async () => {
  setTimeout(() => process.exit(0), 3000).unref();
  await app.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
