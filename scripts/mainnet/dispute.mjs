// Object to an AI ruling during its window, from a script: the house's defense when someone disputes
// a ruling it holds, and the drill when nobody does.
//
//   CONFIRM_MAINNET=yes node scripts/mainnet/dispute.mjs --challenge <id> --evidence "<text>" --plan   print what it would do, change nothing
//   CONFIRM_MAINNET=yes node scripts/mainnet/dispute.mjs --challenge <id> --evidence "<text>"          do it
//   node scripts/mainnet/dispute.mjs --network testnet --challenge <id> --evidence "<text>"            the same on the persistent testnet market
//   options: --deposit <USD>   the most it may move from the owner's USDC into its market balance when that
//                              can't cover the bond; only the shortfall moves
//            --for true|false  the outcome the owner stands for, when it holds no bond here yet (default: its
//                              own latest bond on this challenge, else the claim of the house's Checker)
//            --drill           label the evidence on-chain as a drill of the dispute path
//
// Signed by the owner: NEAR_DEPLOYER_PRIVATE_KEY from .env on mainnet (read only after CONFIRM_MAINNET=yes,
// and only to sign), .apex-test/judge-testnet.json on testnet. --plan reads no key at all. Nothing secret
// is printed. Before it signs anything it reads get_challenge, get_claim, dispute_ends_ns and the latest
// block's time, and refuses: outside the window (no provisional ruling yet, closed, settled or with the
// council); when the ruling already says what the owner holds, because a dispute always flips it; with
// evidence outside 1..4000 bytes; and when the market balance can't cover twice the current bond and
// --deposit doesn't cover the shortfall. The rules are in dispute-plan.mjs. Then, in order:
//   1. the shortfall, if any: ft_transfer_call of USDC to the market (msg "": into the owner's own balance)
//   2. dispute(challenge_id, evidence): the market takes twice the current bond, flips the ruling and
//      restarts the window (the third dispute sends it to the council instead)
// It prints each transaction's hash and link, the ruling after it and the new window's end.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { disputePlan, heldSide } from "./dispute-plan.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const NET = arg("--network", "mainnet");
if (NET !== "mainnet" && NET !== "testnet") throw new Error("--network is mainnet or testnet");
const MAIN = NET === "mainnet";
if (MAIN && process.env.CONFIRM_MAINNET !== "yes") { console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it."); process.exit(1); }
const PLAN = process.argv.includes("--plan");
const DRILL = process.argv.includes("--drill");
const CHALLENGE = Number(arg("--challenge", NaN));
if (!Number.isInteger(CHALLENGE) || CHALLENGE < 0) { console.error("usage: dispute.mjs --challenge <id> --evidence \"<text>\" [--deposit <USD>] [--for true|false] [--drill] [--plan] [--network testnet|mainnet]"); process.exit(1); }
const forArg = arg("--for", null);
if (forArg !== null && forArg !== "true" && forArg !== "false") throw new Error("--for is true or false");
const WANT = forArg === null ? null : forArg === "true";
const depArg = arg("--deposit", null);
if (depArg !== null && !(Number(depArg) > 0)) throw new Error("--deposit is a positive number of US dollars");
const usd = (x) => BigInt(Math.round(Number(x) * 1e6));
const DEPOSIT_CAP = depArg === null ? null : usd(depArg);
const raw = String(arg("--evidence", "") ?? "").trim();
const EVIDENCE = DRILL && raw ? `Drill: the house testing its own dispute path on a real ruling. ${raw}` : raw;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, `deployments/${NET}.json`), "utf8"));
if (dep.network !== NET) throw new Error(`deployments/${NET}.json is not a ${NET} deployment`);
const M = dep.accounts.market, U = dep.accounts.usdc, OWNER = dep.root;
const CHECKER = dep.keys?.checker_account || `checker.${dep.root}`;
const RPCS = MAIN ? (process.env.NEAR_RPC_MAINNET || "https://rpc.fastnear.com,https://near.drpc.org,https://free.rpc.fastnear.com").split(",") : ["https://near-testnet.drpc.org", "https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com"];
const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 4, backoff: 2, wait: 800 })));
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } });
const fmt = (m) => `$${(Number(m) / 1e6).toFixed(2)}`;
const word = (b) => (b === true ? "TRUE" : b === false ? "FALSE" : "none");
const iso = (ns) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
const link = (tx) => `https://${MAIN ? "" : "testnet."}nearblocks.io/txns/${tx}`;
const TGAS = 10n ** 12n;

// ---------- what the chain says ----------
const ch = await view(M, "get_challenge", { challenge_id: CHALLENGE });
const claim = ch ? await view(M, "get_claim", { claim_id: ch.claim_id }) : null;
const endsNs = ch ? await view(M, "dispute_ends_ns", { challenge_id: CHALLENGE }) : null;
const nowNs = (await provider.viewBlock({ finality: "optimistic" })).header.timestamp_nanosec;
const balance = BigInt(await view(M, "get_balance", { trader: OWNER }));
const ownerUsdc = BigInt(await view(U, "ft_balance_of", { account_id: OWNER }));
console.log(`network ${NET}; market ${M}; signer ${OWNER} (the owner): ${fmt(balance)} in the market, ${fmt(ownerUsdc)} USDC`);
if (ch) {
  console.log(`challenge ${CHALLENGE} on claim ${ch.claim_id}: filed by ${ch.challenger} for ${word(ch.claimed_outcome)}; ${ch.disputes} dispute(s); current bond ${fmt(ch.bond_micro)}; ruling now ${word(claim?.provisional)}; claim ${claim?.status ?? "missing"}`);
  console.log(`window ${endsNs ? `ends ${iso(endsNs)}` : "not running"}; chain time ${iso(nowNs)}; the owner holds ${word(WANT ?? heldSide(ch, OWNER, CHECKER))}${WANT !== null ? " (--for)" : ""}`);
  if (claim?.text) console.log(`claim: ${claim.text}`);
}
const plan = disputePlan({ challengeId: CHALLENGE, ch, claim, endsNs, nowNs, signer: OWNER, checker: CHECKER, want: WANT, evidence: EVIDENCE, balance, usdc: ownerUsdc, depositCap: DEPOSIT_CAP });
if (!plan.ok) { console.error(`refused: ${plan.why}`); process.exit(2); }
console.log(`plan: ${plan.deposit ? `deposit ${fmt(plan.deposit)} of the owner's USDC into its market balance, then ` : ""}dispute ${CHALLENGE} with a ${fmt(plan.bond)} bond (twice ${fmt(plan.current)}), flipping the ruling ${word(plan.ruling)} -> ${word(plan.proposed)}; ${plan.escalates ? "this is the third dispute: it goes to the council and opens no window" : "it restarts the window"}`);
console.log(`evidence (${Buffer.byteLength(EVIDENCE, "utf8")} bytes): ${EVIDENCE}`);
if (plan.leftSecs < 60) console.log(`warning: ${plan.leftSecs} s left in the window; a transaction that lands after it closes is refused and takes no bond`);
if (PLAN) process.exit(0);

// ---------- sign ----------
function ownerSecret() {
  if (!MAIN) return JSON.parse(fs.readFileSync(path.join(ROOT, ".apex-test/judge-testnet.json"), "utf8")).key;
  // mainnet: read .env only now, after CONFIRM_MAINNET=yes, and only the one key
  const line = fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((l) => /^NEAR_DEPLOYER_PRIVATE_KEY=(.*)$/.exec(l.trim())).find(Boolean);
  return line ? line[1].trim() : null;
}
const secret = ownerSecret();
if (!secret) throw new Error("the owner's key is not available");
const ownerKey = KeyPair.fromString(secret);
const keys = (await provider.query({ request_type: "view_access_key_list", finality: "final", account_id: OWNER })).keys;
if (!keys.some((k) => k.public_key === ownerKey.getPublicKey().toString())) throw new Error(`the owner's key is not on ${OWNER}`);
const owner = new Account(OWNER, provider, new KeyPairSigner(ownerKey));

/** A failure in any receipt, not only the last status. A deposit the market refuses ends clean, so the balance is read back after it too. */
function failure(r) {
  const bad = (s) => (s && typeof s === "object" && "Failure" in s ? s.Failure : null);
  const f = bad(r.status) ?? (r.receipts_outcome || []).map((x) => bad(x.outcome?.status)).find(Boolean);
  return f ? JSON.stringify(f).slice(0, 300) : null;
}

if (plan.deposit > 0n) {
  const r = await owner.callFunctionRaw({ contractId: U, methodName: "ft_transfer_call", args: { receiver_id: M, amount: String(plan.deposit), msg: "" }, gas: 100n * TGAS, deposit: 1n });
  const tx = r.transaction_outcome?.id || r.transaction?.hash;
  const bad = failure(r);
  if (bad) { console.error(`the deposit failed (tx ${tx}): ${bad}`); process.exit(3); }
  const after = BigInt(await view(M, "get_balance", { trader: OWNER }));
  if (after < plan.bond) { console.error(`the deposit landed (tx ${tx}) but the market balance is ${fmt(after)}, below the ${fmt(plan.bond)} bond: nothing disputed`); process.exit(3); }
  console.log(`ok  deposited ${fmt(plan.deposit)}: tx ${tx} ${link(tx)}`);
}

const r = await owner.callFunctionRaw({ contractId: M, methodName: "dispute", args: { challenge_id: CHALLENGE, evidence: EVIDENCE }, gas: 30n * TGAS, deposit: 0n });
const tx = r.transaction_outcome?.id || r.transaction?.hash;
const bad = failure(r);
if (bad) { console.error(`the dispute failed (tx ${tx}): ${bad}`); process.exit(3); }
const round = r.status?.SuccessValue ? JSON.parse(Buffer.from(r.status.SuccessValue, "base64").toString("utf8")) : null;
console.log(`ok  disputed: round ${round ?? "?"}, tx ${tx} ${link(tx)}`);

// ---------- read back ----------
const claimAfter = await view(M, "get_claim", { claim_id: ch.claim_id });
const endsAfter = await view(M, "dispute_ends_ns", { challenge_id: CHALLENGE });
const balAfter = BigInt(await view(M, "get_balance", { trader: OWNER }));
console.log(`ruling now ${word(claimAfter?.provisional)}; claim ${claimAfter?.status}; market balance ${fmt(balAfter)}`);
if (claimAfter?.status === "Escalated") console.log("the third dispute: the council decides (council_settle), and every bond waits for it");
else console.log(`new window ends ${endsAfter ? iso(endsAfter) : "unknown"}; if nobody disputes by then, anyone can call finalize(${CHALLENGE})`);
