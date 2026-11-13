"use client";
// On a phone, the day's first claims are the page; the rest wait behind one button, so the encyclopedia
// is a thumb's reach away and not four screens down. A wide screen shows everything, always (home.css).
import { useState, type ReactNode } from "react";

export function Fold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tfold" data-open={open || undefined}>
      <div className="tfold-in">{children}</div>
      {!open && <button type="button" className="btn soft lg tfold-btn" aria-expanded="false" onClick={() => setOpen(true)}>{label}</button>}
    </div>
  );
}
