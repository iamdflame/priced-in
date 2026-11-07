"use client";
// The compact header's menu: between the phone's bottom bar and the point where every link fits in the
// header, the same list opens from one button. Escape, a click away or a chosen link closes it.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../Icon";
import { navFor } from "@/lib/nav";

export function NavMenu({ news = false }: { news?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div className="navmenu" ref={box}>
      <button ref={button} type="button" className="iconbtn" aria-label={open ? "Close menu" : "Menu"} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? "x" : "menu"} />
      </button>
      <nav id={id} className="navmenu-panel" aria-label="Menu" hidden={!open}>
        {navFor(news).map((n) => (
          <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={(n.match ? n.match(path) : path === n.href) ? "page" : undefined}><Icon name={n.icon} />{n.label}</Link>
        ))}
      </nav>
    </div>
  );
}
