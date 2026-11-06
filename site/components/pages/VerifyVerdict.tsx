"use client";
// One-tap verify of an AI judge's verdict, in this browser, from the chain alone: read the verdict's
// own transaction from a NEAR RPC, hash the model's signed response, rebuild the signed text
// "<model>:<sha256(request)>:<sha256(response)>", check the ed25519 signature against the key the
// market holds for that model (get_model), and find the market's own "verdict" event in the receipt.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { useState } from "react";
import { Icon } from "../Icon";
import { MARKET_ID } from "@/lib/nav";

const RPCS = ["https://free.rpc.fastnear.com", "https://rpc.fastnear.com", "https://near.drpc.org"];

async function rpc(method: string, params: unknown) {
  let last: unknown = null;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
      last = j.error;
    } catch (e) { last = e; }
  }
  throw new Error(typeof last === "object" && last && "message" in last ? String((last as Error).message) : "No NEAR RPC answered.");
}

const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

type Step = { label: string; ok: boolean | null; detail: string };

export function VerifyVerdict({ tx, model, requestHash, responseHash, sender = "isitpriced.near", compact = false }: {
  tx: string; model: string; requestHash: string; responseHash: string; sender?: string; compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setState("busy"); setErr(null);
    try {
      const out: Step[] = [];
      const t = await rpc("tx", { tx_hash: tx, sender_account_id: sender, wait_until: "NONE" });
      const fc = t.transaction.actions.find((a: any) => a.FunctionCall)?.FunctionCall;
      const args = JSON.parse(new TextDecoder().decode(unb64(fc.args)));
      out.push({ label: "Read the verdict’s transaction from NEAR", ok: fc.method_name === "submit_verdict" && args.model === model, detail: `${fc.method_name} by ${model}` });
      const resp = unb64(args.response);
      const h = bytesToHex(sha256(resp));
      out.push({ label: "sha256 of the model’s response matches", ok: h === responseHash, detail: `${h.slice(0, 12)}…` });
      const text = `${model}:${requestHash}:${h}`;
      const key = await rpc("query", { request_type: "call_function", finality: "final", account_id: MARKET_ID, method_name: "get_model", args_base64: btoa(JSON.stringify({ model })) });
      const reg = JSON.parse(new TextDecoder().decode(Uint8Array.from(key.result)));
      const keyHex = String(reg?.signing_address_hex ?? "");
      out.push({ label: "The market holds a key for this model", ok: keyHex.length === 64, detail: keyHex ? `${keyHex.slice(0, 12)}…` : "none registered" });
      let sigOk = false;
      try { sigOk = ed25519.verify(hexToBytes(args.signature_hex), utf8ToBytes(text), hexToBytes(keyHex)); } catch { sigOk = false; }
      out.push({ label: "The ed25519 signature verifies, here in your browser", ok: sigOk, detail: `over ${model.split("/").pop()}:${requestHash.slice(0, 6)}…:${h.slice(0, 6)}…` });
      const logged = (t.receipts_outcome ?? []).some((r: any) => r.outcome.executor_id === MARKET_ID && r.outcome.logs.some((l: string) => l.includes('"event":"verdict"')) && !("Failure" in (r.outcome.status ?? {})));
      out.push({ label: "The market accepted it and logged the verdict", ok: logged, detail: t.final_execution_status ?? "" });
      setSteps(out);
      setState("done");
    } catch (e) {
      setErr((e as Error).message || "We couldn’t reach NEAR.");
      setState("error");
    }
  }

  const all = steps.length > 0 && steps.every((s) => s.ok);
  if (state === "idle" || state === "busy") {
    return (
      <button type="button" className={`btn ${compact ? "soft" : "ghost"} vbtn`} onClick={run} disabled={state === "busy"} aria-live="polite">
        {state === "busy" ? <><span className="spin" aria-hidden="true" />Checking on NEAR…</> : <><Icon name="shield" />Verify the signature</>}
      </button>
    );
  }
  if (state === "error") {
    return (
      <div className="vres" role="status">
        <p className="sig bad"><Icon name="alert" />Couldn’t check just now</p>
        <p className="fine">{err} Nothing is wrong with the verdict for that; the RPC didn’t answer.</p>
        <button type="button" className="btn soft vbtn" onClick={run}><Icon name="refresh" />Try again</button>
      </div>
    );
  }
  return (
    <div className="vres" role="status">
      <p className={`sig ${all ? "" : "bad"}`}><Icon name={all ? "check" : "x"} />{all ? "Signature ✓ verified in your browser" : "A check failed"}</p>
      <ul className="checks">
        {steps.map((s) => (
          <li key={s.label} className={s.ok ? "" : "fail"}><Icon name={s.ok ? "check" : "x"} /><span>{s.label} <span className="hashv">{s.detail}</span></span></li>
        ))}
      </ul>
    </div>
  );
}
