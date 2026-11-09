// scripts/mainnet/dispute.mjs's go or no-go: it disputes only inside the window, never toward the side
// the owner already holds, with evidence the contract takes, and with the bond covered (the shortfall
// moved in only when --deposit allows it).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { disputePlan, heldSide } from "../../../scripts/mainnet/dispute-plan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("dispute script: mainnet refuses without CONFIRM_MAINNET=yes, before any network or key", () => {
  const r = spawnSync(process.execPath, ["scripts/mainnet/dispute.mjs", "--challenge", "3", "--evidence", "x", "--plan"], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to touch mainnet/);
  assert.equal(r.stdout, "");
});

const NOW = 1_000_000_000_000n;
const ch = (o = {}) => ({
  claim_id: 9, challenger: "checker.isitpriced.near", claimed_outcome: false, evidence: "e", bond_micro: "1000000", disputes: 0, resolved: false,
  stakes: [{ account: "checker.isitpriced.near", side: false, amount_micro: "1000000", evidence: "" }], ...o,
});
const claim = (o = {}) => ({ id: 9, status: "Challenged", provisional: true, challenge_id: 4, ...o });
const base = (o = {}) => ({
  challengeId: 4, ch: ch(), claim: claim(), endsNs: String(NOW + 300_000_000_000n), nowNs: NOW, signer: "isitpriced.near", checker: "checker.isitpriced.near",
  want: null, evidence: "The filing says FALSE: https://example.org/f", balance: 5_000_000n, usdc: 0n, depositCap: null, ...o,
});

test("dispute script: a stranger flipped the house's ruling, so the house defends at twice the bond", () => {
  const p = disputePlan(base());
  assert.equal(p.ok, true);
  assert.deepEqual([p.bond, p.current, p.ruling, p.proposed, p.held, p.deposit, p.round, p.escalates, p.leftSecs], [2_000_000n, 1_000_000n, true, false, false, 0n, 1, false, 300]);
});

test("dispute script: refuses outside the window", () => {
  assert.match(disputePlan(base({ ch: null })).why, /isn't on the chain/);
  assert.match(disputePlan(base({ claim: claim({ provisional: null }) })).why, /haven't reached a provisional ruling/);
  assert.match(disputePlan(base({ nowNs: NOW + 300_000_000_000n })).why, /window closed at/);
  assert.match(disputePlan(base({ endsNs: null })).why, /no dispute window/);
  assert.match(disputePlan(base({ ch: ch({ resolved: true }), claim: claim({ status: "Settled" }) })).why, /settled/);
  assert.match(disputePlan(base({ ch: ch({ disputes: 3 }), claim: claim({ status: "Escalated" }) })).why, /council after 3 disputes/);
  assert.match(disputePlan(base({ claim: claim({ challenge_id: 5 }) })).why, /not under challenge 4/);
});

test("dispute script: refuses to dispute toward the outcome the owner already holds", () => {
  // the house's Checker filed FALSE and the ruling says FALSE: a dispute would flip it to TRUE, against the house
  assert.match(disputePlan(base({ claim: claim({ provisional: false }) })).why, /already says FALSE, the side isitpriced\.near holds/);
  // the owner's own latest bond wins over the Checker's claim
  const defended = ch({ disputes: 2, bond_micro: "4000000", stakes: [...ch().stakes, { account: "a.near", side: true, amount_micro: "2000000", evidence: "x" }, { account: "isitpriced.near", side: false, amount_micro: "4000000", evidence: "y" }] });
  assert.equal(heldSide(defended, "isitpriced.near", "checker.isitpriced.near"), false);
  assert.match(disputePlan(base({ ch: defended, claim: claim({ provisional: false }) })).why, /against itself/);
  // a challenge the house didn't file and holds nothing in: it may dispute either way, unless --for says otherwise
  const stranger = ch({ challenger: "a.near", claimed_outcome: true, stakes: [{ account: "a.near", side: true, amount_micro: "1000000", evidence: "" }] });
  assert.equal(disputePlan(base({ ch: stranger })).ok, true);
  assert.match(disputePlan(base({ ch: stranger, want: true })).why, /already says TRUE/);
  assert.equal(disputePlan(base({ ch: stranger, want: false })).ok, true);
});

test("dispute script: the evidence is 1..4000 bytes, counted as bytes", () => {
  assert.match(disputePlan(base({ evidence: "  " })).why, /--evidence is required/);
  assert.equal(disputePlan(base({ evidence: "x".repeat(4000) })).ok, true);
  assert.match(disputePlan(base({ evidence: "’".repeat(1334) })).why, /4002 bytes/);
});

test("dispute script: the bond comes from the balance, or --deposit moves in only the shortfall", () => {
  assert.match(disputePlan(base({ balance: 500_000n })).why, /pass --deposit <USD> to move the \$1\.50 shortfall/);
  assert.match(disputePlan(base({ balance: 500_000n, depositCap: 1_000_000n, usdc: 9_000_000n })).why, /more than --deposit \$1\.00/);
  assert.match(disputePlan(base({ balance: 500_000n, depositCap: 5_000_000n, usdc: 1_000_000n })).why, /holds \$1\.00 USDC/);
  const p = disputePlan(base({ balance: 500_000n, depositCap: 5_000_000n, usdc: 9_000_000n }));
  assert.deepEqual([p.ok, p.shortfall, p.deposit], [true, 1_500_000n, 1_500_000n]);
});

test("dispute script: the third dispute escalates", () => {
  const two = ch({ disputes: 2, bond_micro: "4000000", stakes: [...ch().stakes, { account: "a.near", side: true, amount_micro: "2000000", evidence: "x" }, { account: "b.near", side: false, amount_micro: "4000000", evidence: "y" }] });
  const p = disputePlan(base({ ch: two, signer: "c.near", checker: null, claim: claim({ provisional: false }), balance: 10_000_000n }));
  assert.deepEqual([p.ok, p.bond, p.round, p.escalates, p.proposed], [true, 8_000_000n, 3, true, true]);
});
