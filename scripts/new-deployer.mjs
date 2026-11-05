// Creates the project's mainnet deployer wallet: an ed25519 key whose public key is its
// own NEAR address (an implicit account). The private key is written to .env and never
// printed. Run it once. It refuses to overwrite an existing key.
import { KeyPair } from "near-api-js";
import fs from "node:fs";

const ENV = ".env";
const text = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
const existing = text.match(/^NEAR_DEPLOYER_ADDRESS=(.+)$/m);
if (existing && existing[1].trim()) {
  console.log(`Deployer already exists: ${existing[1].trim()}`);
  process.exit(0);
}
const kp = KeyPair.fromRandom("ed25519");
const address = Buffer.from(kp.getPublicKey().data).toString("hex");
const block = `NEAR_DEPLOYER_ADDRESS=${address}\nNEAR_DEPLOYER_PRIVATE_KEY=${kp.toString()}\n`;
fs.writeFileSync(ENV, text.replace(/^NEAR_DEPLOYER_ADDRESS=.*\nNEAR_DEPLOYER_PRIVATE_KEY=.*\n/m, "") + block);
console.log(`Deployer address: ${address}`);
