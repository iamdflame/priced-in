"use client";
// The site's chrome: the nav (desktop), the phone's top bar and bottom bar, the theme toggle, search,
// the replay bar and the offline notice.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Lockup } from "./Brand";
import { Icon } from "./Icon";
import { NAV } from "@/lib/nav";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);
  useEffect(() => { setTheme((document.documentElement.dataset.theme as "dark" | "light") || "dark"); }, []);
  const flip = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pi-theme", next); } catch { /* private mode */ }
    setTheme(next);
  };
  return (
    <button type="button" className="iconbtn" onClick={flip} aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
      <Icon name={theme === "light" ? "moon" : "sun"} />
    </button>
  );
}

/** Search facts: filters the home grid as you type (a GET form, so it works before scripts load). */
function Search() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); input.current?.focus(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const change = (v: string) => {
    setQ(v);
    if (path === "/") window.dispatchEvent(new CustomEvent("pi:search", { detail: v }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    router.push(q ? `/?q=${encodeURIComponent(q)}#facts` : "/#facts");
  };
  return (
    <form className="search" role="search" action="/" onSubmit={submit}>
      <Icon name="search" />
      <input ref={input} type="search" name="q" value={q} onChange={(e) => change(e.target.value)} placeholder="Search facts" aria-label="Search facts" autoComplete="off" />
      <kbd aria-hidden="true">/</kbd>
    </form>
  );
}

export function Nav() {
  const path = usePathname();
  const recorded = useSearchParams().get("recorded") === "1";
  const cta = recorded ? "/c/18?recorded=1" : "/#facts";
  return (
    <>
      <ReplayBar on={recorded} />
      <header className="nav">
        <div className="wrap">
          <Link className="logo" href="/" aria-label="Priced In, home"><Lockup /></Link>
          <Search />
          <nav className="navlinks" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={(n.match ? n.match(path) : path === n.href) ? "page" : undefined}>{n.label}</Link>
            ))}
          </nav>
          <div className="nav-actions">
            <ThemeToggle />
            <Link className="btn primary" href={cta}>Bet $1 free</Link>
          </div>
        </div>
      </header>
      <div className="pbar">
        <Link className="logo" href="/" aria-label="Priced In, home"><Lockup /></Link>
        <div className="r">
          <ThemeToggle />
          <Link className="iconbtn" href="/?q=#facts" aria-label="Search facts"><Icon name="search" /></Link>
          <Link className="btn primary" href={cta}>Free $1</Link>
        </div>
      </div>
    </>
  );
}

export function PhoneNav() {
  const path = usePathname();
  const [hash, setHash] = useState("");
  useEffect(() => {
    const on = () => setHash(location.hash);
    on();
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, [path]);
  const items = NAV.filter((n) => n.phone).slice(0, 4);
  return (
    <nav className="pnav" aria-label="Main" style={{ ["--n" as any]: items.length }}>
      {items.map((n) => {
        const here = n.href.includes("#") ? path === "/" && hash === n.href.slice(1) : (n.match ? n.match(path) : path === n.href) && !hash.startsWith("#d") && !hash.startsWith("#r") && !hash.startsWith("#h");
        return <Link key={n.href} href={n.href} aria-current={here ? "page" : undefined}><Icon name={n.icon} />{n.label}</Link>;
      })}
    </nav>
  );
}

export function ReplayBar({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <div className="replaybar" role="status">
      <div className="wrap">
        <span><b>Replay of a real mainnet run.</b><span className="long"> The free $1 on the T-Bills fact, its signed rewrite and the AI judges’ ruling, as recorded on 5–6 Nov 2026.</span> Nothing is sent.</span>
        <a href="/">Back to live</a>
      </div>
    </div>
  );
}

export function OfflineNotice() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const on = () => setOff(!navigator.onLine);
    on();
    addEventListener("online", on);
    addEventListener("offline", on);
    return () => { removeEventListener("online", on); removeEventListener("offline", on); };
  }, []);
  if (!off) return null;
  return <div className="offline" role="status"><Icon name="wifi" />You’re offline. Prices will update when you’re back.</div>;
}
