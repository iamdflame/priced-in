"use client";
// Loading skeletons, empty and error states. An error always says what happened in plain words and
// offers a way on: try again, or watch the replay of a real run.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Icon, type IconName } from "./Icon";
import { REPLAY_HREF } from "@/lib/nav";

export function Sk({ w = "100%", h = 16, r, className = "" }: { w?: number | string; h?: number | string; r?: number; className?: string }) {
  return <span className={`sk block ${className}`} style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

export function CardSkeleton() {
  return (
    <div className="card" aria-hidden="true">
      <Sk h={158} r={0} />
      <div className="cbody"><Sk h={18} /><Sk w="70%" h={18} /><div className="bets"><Sk h={56} r={14} /><Sk h={56} r={14} /></div><Sk w="50%" h={12} /></div>
    </div>
  );
}

export function StateBox({ icon = "info", title, children, actions }: { icon?: IconName; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="state">
      <Icon name={icon} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="acts">{actions}</div>}
    </section>
  );
}

export function Retry({ label = "Try again", reset }: { label?: string; reset?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn primary" disabled={pending} onClick={() => start(() => { reset?.(); router.refresh(); })}>
      <Icon name="refresh" />{pending ? "Trying…" : label}
    </button>
  );
}

export function ErrorState({ message, reset }: { message: string; reset?: () => void }) {
  return (
    <StateBox icon="alert" title="We can’t reach the market right now" actions={<><Retry reset={reset} /><Link className="btn soft" href={REPLAY_HREF}>Watch a replay</Link></>}>
      {message} Prices live on NEAR either way; nothing is lost. Try again in a moment, or watch the replay of a real run.
    </StateBox>
  );
}
