"use client";
// A list that shows its first few rows, then expands in place, like the home grid: the page stays short
// and nothing loads twice.
import { useState, type ReactNode } from "react";

export function More({ n, shown, label, children, className = "" }: { n: number; shown: number; label: string; children: ReactNode; className?: string }) {
  const [all, setAll] = useState(false);
  const clamped = !all && n > shown;
  return (
    <>
      <ol className={`lrows ${className}`} data-clamped={clamped || undefined} style={{ ["--shown" as string]: shown }}>{children}</ol>
      {clamped && <button type="button" className="btn soft lrmore" onClick={() => setAll(true)}>{label}</button>}
    </>
  );
}
