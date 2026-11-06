"use client";
// Search facts: filters the home grid as you type. A GET form, so it works before scripts load. The
// grid listens for the "pi:search" event; "/" focuses the box from anywhere.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "../Icon";

export const SEARCH_EVENT = "pi:search";

export function Search() {
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState(useSearchParams().get("q") ?? "");
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
    if (path === "/") dispatchEvent(new CustomEvent(SEARCH_EVENT, { detail: v }));
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
