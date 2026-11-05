import { describe, expect, test } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import fixture from "./fixtures/rewrite-signed.json";
import { verifyRewrite, anchorFromEvents, sha256Hex, signedSentences, type VerifyDeps } from "../src/core/verify";
import { b64, unb64 } from "../src/core/rpc";
import type { Rewrite } from "../src/core/api";

const real = () => structuredClone(fixture.record) as unknown as Rewrite;
const registered: VerifyDeps = { modelKey: async (m) => (m === fixture.model ? fixture.signer : null) };
const byId = (r: Awaited<ReturnType<typeof verifyRewrite>>) => Object.fromEntries(r.steps.map((s) => [s.id, s.status]));

describe("verify: a real signed rewrite from services/ai", () => {
  test("every deciding step passes and the chip says signed in a TEE", async () => {
    const r = await verifyRewrite(real(), registered);
    expect(r.ok).toBe(true);
    expect(r.chip).toBe(`signed by ${fixture.model} in a TEE · verify`);
    expect(byId(r)).toEqual({ bytes: "pass", request_hash: "pass", response_hash: "pass", signed_text: "pass", signature: "pass", registered_key: "pass", text: "pass", anchor: "skip" });
    expect(r.anchored).toBe(false);
    expect(r.steps.find((s) => s.id === "anchor")!.detail).toMatch(/Not anchored/);
  });

  test("the words on the page are the words in the signed response", () => {
    const rec = real();
    expect(signedSentences(unb64(rec.provenance.response_b64!))).toEqual(rec.sentences.map((s) => s.text));
  });

  test("an on-chain anchor_rewrite with the same hashes passes; one with other hashes fails", async () => {
    const rec = real();
    const p = rec.provenance;
    const anchorData = { claim_id: 0, version: 1, prices_hash: "0".repeat(64), request_hash: p.request_hash, response_hash: p.response_hash, signature: p.signature, model: p.model };
    const events = [{ event: "rewrite", source: "ai", txHash: "nope", data: { ...anchorData } }, { event: "rewrite", txHash: "AnchorTx1", signerId: "writer.testnet", data: anchorData }];
    const deps: VerifyDeps = { ...registered, findAnchor: anchorFromEvents(events), anchorEvents: async (tx) => (tx === "AnchorTx1" ? [anchorData] : []) };
    const r = await verifyRewrite(rec, deps);
    expect(r.ok).toBe(true);
    expect(r.anchored).toBe(true);
    expect(r.steps.find((s) => s.id === "anchor")!.detail).toMatch(/AnchorTx1/);
    const wrong = await verifyRewrite(rec, { ...deps, anchorEvents: async () => [{ ...anchorData, response_hash: "f".repeat(64) }] });
    expect(byId(wrong).anchor).toBe("fail");
    expect(wrong.ok).toBe(true); // signed still holds; the anchor is reported on its own
    expect(wrong.anchored).toBe(false);
  });
});

describe("verify: forgeries", () => {
  test("a response edited after signing: its hash and the signed words fail", async () => {
    const rec = real();
    const resp = new TextDecoder().decode(unb64(rec.provenance.response_b64!)).replace("unlikely", "certain");
    rec.provenance.response_b64 = b64(new TextEncoder().encode(resp));
    const r = await verifyRewrite(rec, registered);
    expect(r.ok).toBe(false);
    expect(byId(r).response_hash).toBe("fail");
    expect(byId(r).signature).toBe("fail");
    expect(r.chip).toMatch(/^not verified/);
  });

  test("a forger who re-hashes and re-signs with their own key: the registered key fails", async () => {
    const rec = real();
    const p = rec.provenance;
    const resp = new TextDecoder().decode(unb64(p.response_b64!)).replace("unlikely", "certain");
    const respBytes = new TextEncoder().encode(resp);
    p.response_b64 = b64(respBytes);
    p.response_hash = sha256Hex(respBytes);
    p.signed_text = `${p.model}:${p.request_hash}:${p.response_hash}`;
    const sk = ed25519.utils.randomSecretKey();
    p.signature = bytesToHex(ed25519.sign(new TextEncoder().encode(p.signed_text), sk));
    p.signing_address = bytesToHex(ed25519.getPublicKey(sk));
    rec.sentences = rec.sentences.map((s) => ({ ...s, text: s.text.replace("unlikely", "certain") }));
    const r = await verifyRewrite(rec, registered);
    expect(byId(r)).toMatchObject({ request_hash: "pass", response_hash: "pass", signed_text: "pass", signature: "pass", text: "pass", registered_key: "fail" });
    expect(r.ok).toBe(false);
  });

  test("a page that shows other words than the signed ones fails the text step", async () => {
    const rec = real();
    rec.sentences[0] = { ...rec.sentences[0], text: "NEAR Intents certainly processed $10 billion." };
    const r = await verifyRewrite(rec, registered);
    expect(byId(r).text).toBe("fail");
    expect(byId(r).signature).toBe("pass");
    expect(r.ok).toBe(false);
  });

  test("a signature over another text, a gateway signature, a missing key and missing bytes all fail plainly", async () => {
    const a = real();
    a.provenance.signed_text = `${a.provenance.model}:${"0".repeat(64)}:${"1".repeat(64)}`;
    expect(byId(await verifyRewrite(a, registered)).signed_text).toBe("fail");

    const g = real();
    g.provenance.signature_kind = "gateway";
    expect(byId(await verifyRewrite(g, registered)).signed_text).toBe("fail");

    const unreg = await verifyRewrite(real(), { modelKey: async () => null });
    expect(byId(unreg).registered_key).toBe("fail");
    expect(unreg.steps.find((s) => s.id === "registered_key")!.detail).toMatch(/no key registered/);

    const down = await verifyRewrite(real(), { modelKey: async () => { throw new Error("RPC down"); } });
    expect(byId(down).registered_key).toBe("fail");

    const lite = real();
    delete lite.provenance.request_b64;
    const l = await verifyRewrite(lite, registered);
    expect(l.steps).toHaveLength(1);
    expect(l.steps[0].detail).toMatch(/GET \/rewrites/);

    const tpl = real();
    tpl.provenance = { kind: "template", status: "template", verified: false, model: null };
    const t = await verifyRewrite(tpl, registered);
    expect(t.ok).toBe(false);
    expect(t.chip).toBe("unsigned");
  });

  test("a flipped bit in the signature fails", async () => {
    const rec = real();
    const s = rec.provenance.signature!;
    rec.provenance.signature = (s[0] === "0" ? "1" : "0") + s.slice(1);
    const r = await verifyRewrite(rec, registered);
    expect(byId(r).signature).toBe("fail");
    expect(byId(r).request_hash).toBe("pass");
  });
});
