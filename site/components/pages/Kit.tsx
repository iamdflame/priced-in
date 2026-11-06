// Shared pieces of the proof pages: the page hero, key numbers, section heads, code blocks and the
// AI traders' dishes. Server components; the copy button is the only client part.
import type { ReactNode } from "react";
import { CopyButton } from "./Copy";

export function PageHero({ kick, title, lede, side, actions, live = true }: { kick: ReactNode; title: ReactNode; lede: ReactNode; side?: ReactNode; actions?: ReactNode; live?: boolean }) {
  return (
    <section className={`phero ${side ? "" : "solo"}`} aria-labelledby="ph-title">
      <div>
        <span className="kick">{live && <span className="dot" aria-hidden="true" />}{kick}</span>
        <h1 id="ph-title">{title}</h1>
        <p className="lede">{lede}</p>
        {actions && <div className="acts">{actions}</div>}
      </div>
      {side && <div className="phero-side">{side}</div>}
    </section>
  );
}

export interface Kpi { v: ReactNode; l: ReactNode; s?: ReactNode; tone?: "pos" | "neg" }

export function Kpis({ items, label }: { items: Kpi[]; label: string }) {
  return (
    <dl className="kpis" aria-label={label} style={{ ["--k" as any]: items.length }}>
      {items.map((k, i) => (
        <div className="kpi" key={i}>
          <dd className={`v ${k.tone ?? ""}`}>{k.v}</dd>
          <dt className="l">{k.l}</dt>
          {k.s && <dd className="s">{k.s}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function SHead({ id, title, sub, right }: { id?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="shead">
      <div>
        <h2 id={id}>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {right && <div className="r">{right}</div>}
    </div>
  );
}

export function Code({ children, copy, label }: { children: string; copy?: string; label?: string }) {
  return (
    <div>
      {(label || copy !== undefined) && (
        <div className="codehd"><span>{label}</span><CopyButton text={copy ?? children} /></div>
      )}
      <pre className="code" tabIndex={0}>{children}</pre>
    </div>
  );
}

/** The AI trader's dish: its persona's initial on its colour. */
export function Dish({ persona, size = "big" }: { persona: string; size?: "big" | "xl" | "" }) {
  return <span className={`ag ${size} ${persona}`} aria-hidden="true">{persona.charAt(0)}</span>;
}

/** An AI judge's mark, name and maker: the same on /rulings and /trust. */
export function ModelBadge({ model, note }: { model: string; note?: string }) {
  const m = modelMaker(model);
  return <div className="who"><span className="mk" aria-hidden="true">{m.mark}</span><div><b title={model}>{m.short}</b><small>{note ? `${m.maker} · ${note}` : m.maker}</small></div></div>;
}

/** "deepseek-ai/DeepSeek-V4.1-Flash-1017" to its maker and a two-letter mark. */
export function modelMaker(m: string): { maker: string; mark: string; short: string } {
  const short = m.split("/").pop()!.replace(/-\d{4}$/, "");
  if (/deepseek/i.test(m)) return { maker: "DeepSeek", mark: "DS", short };
  if (/qwen/i.test(m)) return { maker: "Qwen", mark: "Qw", short };
  if (/glm|z-ai/i.test(m)) return { maker: "Z.ai GLM", mark: "GL", short };
  return { maker: m.split("/")[0], mark: short.slice(0, 2), short };
}
