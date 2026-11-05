// Agent personas. A persona is the owner's instructions to its agent's model plus its betting
// limits. On-chain the swarm keeps only its sha256 (persona_hash); the text lives here, in
// code for the three house agents and in personas.jsonl for strangers' agents, and anyone can
// check a text against the hash. Limits are clamped to the house caps: a persona can make an
// agent more careful, never bolder than $2 a bet, $5 of daily loss and quarter Kelly.
//
// The persona goes into the credence request's system prompt. It never carries the market
// price, so an agent's credence stays its own.

import { createHash } from "node:crypto";

export const LIMIT_CAPS = Object.freeze({ maxBetUsd: 2, dailyLossLimitUsd: 5, kellyFraction: 0.25 });
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

export const HOUSE_PERSONAS = Object.freeze([
  {
    key: "house-archivist",
    model: "Qwen/Qwen3.8-27B",
    persona: {
      name: "Archivist",
      instructions: "Weigh primary records and standard reference works above everything else. A claim an official record or a reference work documents is likely true; one they contradict is likely false. Say which record you relied on.",
      limits: { maxBetUsd: 2, dailyLossLimitUsd: 5, kellyFraction: 0.25 },
    },
  },
  {
    key: "house-skeptic",
    model: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
    persona: {
      name: "Skeptic",
      instructions: "Look first for why the claim could be false: a missing qualifier, an outdated figure, a single unsourced report, a definition stretched. Stay below 0.9 unless two independent sources agree.",
      limits: { maxBetUsd: 1.5, dailyLossLimitUsd: 4, kellyFraction: 0.2 },
    },
  },
  {
    key: "house-quant",
    model: "z-ai/glm-5.3-flash",
    persona: {
      name: "Quant",
      instructions: "Start from the base rate for claims of this kind, then update on the sources. Prefer calibrated, moderate probabilities to confident ones.",
      limits: { maxBetUsd: 1, dailyLossLimitUsd: 3, kellyFraction: 0.15 },
    },
  },
]);

export const DEFAULT_PERSONA = Object.freeze({ name: "Unregistered", instructions: "Be careful and calibrated.", limits: { maxBetUsd: 1, dailyLossLimitUsd: 2, kellyFraction: 0.1 } });

const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/** A clean persona or an error. Unknown fields are dropped; text is trimmed and bounded. */
export function normalizePersona(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("a persona must be an object");
  const name = String(p.name ?? "").replace(/\s+/g, " ").trim();
  const instructions = String(p.instructions ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 40) throw new Error("persona name must be 1 to 40 characters");
  if (!instructions || instructions.length > 600) throw new Error("persona instructions must be 1 to 600 characters");
  const l = p.limits || {};
  return {
    name,
    instructions,
    limits: {
      maxBetUsd: clamp(l.maxBetUsd, 0.1, LIMIT_CAPS.maxBetUsd, 1),
      dailyLossLimitUsd: clamp(l.dailyLossLimitUsd, 0.1, LIMIT_CAPS.dailyLossLimitUsd, 2),
      kellyFraction: clamp(l.kellyFraction, 0.01, LIMIT_CAPS.kellyFraction, 0.1),
    },
  };
}

/** The exact bytes the hash covers: fixed key order, version 1. */
export function personaJson(p) {
  const n = normalizePersona(p);
  return JSON.stringify({ v: 1, name: n.name, instructions: n.instructions, limits: { maxBetUsd: n.limits.maxBetUsd, dailyLossLimitUsd: n.limits.dailyLossLimitUsd, kellyFraction: n.limits.kellyFraction } });
}

export const personaHash = (p) => sha(personaJson(p));

export const HOUSE_BY_HASH = new Map(HOUSE_PERSONAS.map((h) => [personaHash(h.persona), h]));

export class PersonaRegistry {
  /** @param {import('./journal.js').Journal} journal */
  constructor(journal) {
    this.journal = journal;
    this.byHash = new Map([...HOUSE_BY_HASH].map(([h, x]) => [h, normalizePersona(x.persona)]));
    for (const r of journal?.read() || []) {
      try { if (personaHash(r.persona) === r.persona_hash) this.byHash.set(r.persona_hash, normalizePersona(r.persona)); } catch { /* skip a bad line */ }
    }
  }

  /** Register a persona text; returns its hash. Registering the same text twice is a no-op. */
  add(persona) {
    const n = normalizePersona(persona);
    const h = personaHash(n);
    if (!this.byHash.has(h)) {
      this.byHash.set(h, n);
      this.journal?.append({ at: new Date().toISOString(), persona_hash: h, persona: n });
    }
    return h;
  }

  get(hash) { return this.byHash.get(hash) || null; }
}
