"use client";
// The money screens' parts: the sheet (a dialog on desktop, a bottom sheet on the phone), the approval
// box that says in plain sentences what the wallet is about to sign, the amount field, the region line,
// the QR code and the copyable address.
import "@/app/styles/money.css";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { Icon } from "../Icon";
import { geoLine } from "@/lib/money/geo";
import { useGeo } from "@/lib/money/hooks";
import type { TxSpec } from "@/lib/money/tx";

export function Sheet({ title, sub, onClose, children, wide = false, label }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus], input, button:not([data-close]), a[href]");
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !el) return;
      const f = [...el.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="m-sheet" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`m-panel ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id} aria-label={label} ref={ref} tabIndex={-1}>
        <div className="m-head">
          <div><h2 id={id}>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close" data-close><Icon name="x" /></button>
        </div>
        <div className="m-body">{children}</div>
      </div>
    </div>
  );
}

/** The one line wherever real money moves: the region rule if there is one, else the preview's terms. */
export function GeoLine({ always = true }: { always?: boolean }) {
  const g = useGeo();
  const line = geoLine(g.access, g.country);
  if (line) return <p className="m-geo warn" role="note"><Icon name="info" />{line} <Link href="/terms#regions">Why</Link></p>;
  if (!always) return null;
  return <p className="m-geo" role="note"><Icon name="shield" /><span>Real USDC on NEAR, in a micro-stakes research preview. You can lose what you bet. <Link href="/terms">Terms</Link></span></p>;
}

/** What the wallet will sign, said before the tap. */
export function ApproveBox({ txs }: { txs: TxSpec[] }) {
  if (!txs.length) return null;
  return (
    <div className="m-approve" data-testid="approve">
      <Icon name="shield" />
      <div>
        <span className="t">{txs.length > 1 ? `Your wallet will ask you to approve ${txs.length} steps` : "You’re approving"}</span>
        {txs.length > 1 ? <ol>{txs.map((t, i) => <li key={i}>{t.says}</li>)}</ol> : <p>{txs[0].says}</p>}
      </div>
    </div>
  );
}

export function AmountInput({ value, onChange, label, side, presets, onPreset, max, onMax, invalid }: {
  value: string; onChange: (v: string) => void; label: string; side?: ReactNode; presets?: number[]; onPreset?: (n: number) => void; max?: string | null; onMax?: () => void; invalid?: string | null;
}) {
  const id = useId();
  return (
    <div className="m-field">
      <label htmlFor={id} className="m-label">{label}</label>
      <div className="m-amt">
        <span className="cur" aria-hidden="true">$</span>
        <input id={id} inputMode="decimal" autoComplete="off" placeholder="0" value={value} aria-invalid={invalid ? true : undefined}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").replace(/^(\d*\.\d{0,6}).*$/, "$1"))} />
        <div className="side">{side}{max && onMax ? <button type="button" onClick={onMax}>Max {max}</button> : null}</div>
      </div>
      {presets && onPreset ? <div className="m-presets">{presets.map((p) => <button key={p} type="button" onClick={() => onPreset(p)}>${p}</button>)}</div> : null}
      {invalid ? <p className="bad" role="alert">{invalid}</p> : null}
    </div>
  );
}

export function QR({ text, label }: { text: string; label: string }) {
  const [svg, setSvg] = useState<string>("");
  useEffect(() => {
    let off = false;
    QRCode.toString(text, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0B0F13", light: "#FFFFFF" } }).then((s) => { if (!off) setSvg(s); }).catch(() => {});
    return () => { off = true; };
  }, [text]);
  return <div className="code" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="m-addr">
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600); }); }} aria-label={`${label}: ${text}`}>{done ? "Copied" : label}</button>
    </div>
  );
}

export function Countdown({ to }: { to: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((to - now) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return <span className="num">{h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`}</span>;
}

export function Done({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="m-done" role="status" data-testid="money-done">
      <span className="badge"><Icon name="check" /></span>
      <h3>{title}</h3>
      {children}
      {actions}
    </div>
  );
}

export function Failed({ text }: { text: string }) {
  return <div className="notice err" role="alert"><Icon name="alert" /><p><b>Nothing went through.</b> {text}</p></div>;
}
