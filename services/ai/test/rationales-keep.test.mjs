// The answers /rationales serves: every claim keeps its own last answers, so a settled market's discussion
// doesn't vanish when the agents keep answering the open ones (claim 18 read "Discussion 0" on 7 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { keepRationales, RATIONALES_PER_CLAIM } from "../src/agents.js";

test("each claim keeps its last answers; a busy claim can't push a quiet one out", () => {
  const old = Array.from({ length: 30 }, (_, i) => ({ claim_id: 18, at: i }));
  const busy = Array.from({ length: 900 }, (_, i) => ({ claim_id: 39 + (i % 4), at: 100 + i }));
  const kept = keepRationales([...old, ...busy]);
  const of = (id) => kept.filter((r) => r.claim_id === id);
  assert.equal(of(18).length, RATIONALES_PER_CLAIM, "the settled market keeps its discussion");
  assert.deepEqual(of(18).map((r) => r.at), Array.from({ length: RATIONALES_PER_CLAIM }, (_, i) => 30 - RATIONALES_PER_CLAIM + i), "its newest answers, in order");
  for (const id of [39, 40, 41, 42]) assert.equal(of(id).length, RATIONALES_PER_CLAIM);
  assert.deepEqual(kept.map((r) => r.at), [...kept.map((r) => r.at)].sort((a, b) => a - b), "newest last, as before");
  assert.equal(keepRationales(busy, { perClaim: 1000, cap: 300 }).length, 300, "never more than the cap");
});
