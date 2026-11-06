"use client";
// A copy button for code and hashes: says "Copied" for a moment, and falls back to selecting the text.
import { useState } from "react";
import { Icon } from "../Icon";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="copyb" aria-label={`${label}: ${text.slice(0, 60)}`}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* clipboard blocked: the text stays selectable */ }
      }}>
      <Icon name={done ? "check" : "link"} />{done ? "Copied" : label}
    </button>
  );
}
