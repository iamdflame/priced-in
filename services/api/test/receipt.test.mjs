import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { createHash } from "node:crypto";
import { KeyPair } from "near-api-js";
import { parseSigningKey, receiptMessage, signReceipt, toP0Ppm, parsePlannerReply, pasteSlug, validPage, plannerRequest, PLANNER_EXTRAS } from "../src/planner.mjs";

// The contract's format, rebuilt independently from contracts/market/src/lib.rs (open_and_buy):
// format!("open:{}:{}:{}:{}:{}", page, hex(&env::sha256(text.as_bytes())), kind, p0_ppm, b_micro.0)
const contractMessage = (page, text, kind, p0, b) => `open:${page}:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}:${kind}:${p0}:${b}`;

test("the receipt message is exactly the contract's format", () => {
  const args = { page: "paste-demo", text: "Bananas are botanically berries.", kind: "document", p0_ppm: 600000, b_micro: 1000000 };
  assert.equal(receiptMessage(args), contractMessage("paste-demo", "Bananas are botanically berries.", "document", 600000, 1000000));
  assert.equal(receiptMessage(args), "open:paste-demo:" + createHash("sha256").update("Bananas are botanically berries.").digest("hex") + ":document:600000:1000000");
});

test("the signature verifies with tweetnacl over the contract's message, and the args are ready for open_and_buy", () => {
  const kp = nacl.sign.keyPair();
  const text = "NEAR Intents passed $10 billion in volume — per the explorer.";
  const r = signReceipt(kp, { page: "near-intents", text, kind: "data", p0_ppm: 640000, b_micro: 1000000 });
  const msg = contractMessage("near-intents", text, "data", 640000, 1000000);
  assert.equal(r.message, msg);
  assert.equal(r.planner_sig_hex.length, 128);
  assert.ok(nacl.sign.detached.verify(Buffer.from(msg), Buffer.from(r.planner_sig_hex, "hex"), kp.publicKey));
  assert.deepEqual(Object.keys(r.args).sort(), ["b_micro", "kind", "p0_ppm", "page", "planner_sig_hex", "text"]);
  assert.equal(r.args.b_micro, "1000000", "U128 travels as a string");
  // any change to the terms breaks the signature
  const forged = contractMessage("near-intents", text, "data", 650000, 1000000);
  assert.equal(nacl.sign.detached.verify(Buffer.from(forged), Buffer.from(r.planner_sig_hex, "hex"), kp.publicKey), false);
});

test("never signs unpriceable kinds or out-of-range openings", () => {
  const kp = nacl.sign.keyPair();
  for (const kind of ["person", "unfalsifiable", "opinion"]) {
    assert.throws(() => signReceipt(kp, { page: "p", text: "x", kind, p0_ppm: 500000, b_micro: 1000000 }));
  }
  assert.throws(() => signReceipt(kp, { page: "p", text: "x", kind: "data", p0_ppm: 900000, b_micro: 1000000 }));
  assert.throws(() => signReceipt(kp, { page: "p", text: "x", kind: "data", p0_ppm: 500000.5, b_micro: 1000000 }));
});

test("signing keys: NEAR ed25519: strings, 64-byte hex and 32-byte hex seeds", () => {
  const near = KeyPair.fromRandom("ed25519");
  const a = parseSigningKey(near.toString());
  assert.equal(Buffer.from(a.publicKey).toString("hex"), Buffer.from(near.getPublicKey().data).toString("hex"));
  const seed = Buffer.alloc(32, 7);
  const b = parseSigningKey(seed.toString("hex"));
  assert.equal(Buffer.from(b.publicKey).toString("hex"), Buffer.from(nacl.sign.keyPair.fromSeed(seed).publicKey).toString("hex"));
  const c = parseSigningKey(Buffer.from(b.secretKey).toString("hex"));
  assert.deepEqual(Buffer.from(c.publicKey), Buffer.from(b.publicKey));
  const bad = Buffer.from(b.secretKey);
  bad[40] ^= 1;
  assert.throws(() => parseSigningKey(bad.toString("hex")), /does not match/);
  assert.throws(() => parseSigningKey("hello"));
  assert.throws(() => parseSigningKey(""));
});

test("opening probabilities clamp to 0.2..0.8 and round to 0.1 point", () => {
  assert.equal(toP0Ppm(0.5), 500000);
  assert.equal(toP0Ppm(0.95), 800000);
  assert.equal(toP0Ppm(0.01), 200000);
  assert.equal(toP0Ppm(0.6234), 623000);
  assert.equal(toP0Ppm(62), 620000, "a percentage is read as a percentage");
  assert.equal(toP0Ppm("x"), null);
});

test("planner replies: JSON in fences or prose parses; bad labels and indexes are dropped", () => {
  const reply = 'Sure!\n```json\n{"labels":[{"i":0,"label":"data","p":0.7},{"i":1,"label":"person","p":0.5},{"i":2,"label":"banana"},{"i":9,"label":"data","p":0.5},{"i":3,"label":"judgment"}]}\n```';
  const out = parsePlannerReply(reply, 4);
  assert.deepEqual(out[0], { label: "data", p0_ppm: 700000 });
  assert.deepEqual(out[1], { label: "person", p0_ppm: null });
  assert.equal(out[2], null, "unknown label");
  assert.equal(out[3], null, "a priceable label without a probability is not priced");
  assert.deepEqual(parsePlannerReply('[{"i":0,"label":"unfalsifiable"}]', 1), [{ label: "unfalsifiable", p0_ppm: null }]);
  assert.throws(() => parsePlannerReply("I cannot help with that.", 2));
  assert.throws(() => parsePlannerReply(undefined, 2));
});

test("page slugs: stable for the same sentences and safe for the receipt's ':' separators", () => {
  assert.equal(pasteSlug(["A.", "B."]), pasteSlug(["A.", "B."]));
  assert.notEqual(pasteSlug(["A.", "B."]), pasteSlug(["A.", "C."]));
  assert.ok(validPage(pasteSlug(["A."])));
  assert.equal(validPage("near-intents"), true);
  for (const bad of ["Near", "a:b", "-x", "x-", "", "a".repeat(65), "a b"]) assert.equal(validPage(bad), false, bad);
});

test("planner requests turn reasoning off per model and keep the fixed fields", () => {
  const glm = plannerRequest("z-ai/glm-5.3-flash", ["a", "b"]);
  assert.equal(glm.reasoning_effort, "low");
  assert.equal(glm.max_tokens, 160);
  assert.equal(glm.stream, false);
  assert.equal(glm.temperature, 0);
  assert.deepEqual(plannerRequest("deepseek-ai/DeepSeek-V4.1-Flash-1017", ["a"]).chat_template_kwargs, { thinking: false });
  assert.equal(plannerRequest("some/other-model", ["a"]).chat_template_kwargs, undefined);
  for (const x of Object.values(PLANNER_EXTRAS)) for (const k of ["model", "messages", "max_tokens", "stream", "temperature"]) assert.ok(!(k in x));
});
