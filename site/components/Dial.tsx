// The dial: a Blender render of a machined face with a live SVG needle on top: ceramic and aluminium on
// white (public/art/light/dial.webp), graphite in the dark theme (public/art/dial.webp).
// 0-100% maps to -120 to +120 degrees, so the needle always shows the real price. Server-safe; the
// receipt's SwingDial (components/Receipt) moves it from the old price to the new one.
import { Art } from "./Art";
import type { CSSProperties } from "react";

export function Dial({ p, label, read = true, sizes = "300px", priority = false, className = "", go = false }: {
  p: number; label?: string; read?: boolean; sizes?: string; priority?: boolean; className?: string; go?: boolean;
}) {
  const pct = Math.round(p * 100);
  return (
    <div className={`dial ${go ? "go" : ""} ${className}`} style={{ "--p": Math.min(1, Math.max(0, p)) } as CSSProperties} role="img" aria-label={`${pct}% chance it’s true`}>
      <Art name="dial" width={900} height={900} sizes={sizes} priority={priority} eager />
      <span className="scale a" aria-hidden="true">0</span><span className="scale b" aria-hidden="true">100</span>
      <div className="needle" aria-hidden="true">
        <svg viewBox="0 0 20 100" preserveAspectRatio="none"><path d="M10 0C10.9 0 11.5.6 11.7 1.5L16 100H4L8.3 1.5C8.5.6 9.1 0 10 0Z" fill="oklch(.86 .15 205)" /></svg>
      </div>
      <div className="ring" aria-hidden="true" />
      <div className="hub" aria-hidden="true" />
      {read && (
        <div className="read" aria-hidden="true">
          <span className="n">{pct}<i>%</i></span>
          {label && <span className="l">{label}</span>}
        </div>
      )}
    </div>
  );
}
