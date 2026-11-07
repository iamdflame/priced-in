"use client";
// The phone's bottom bar, from the same list as the desktop nav.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { Icon } from "../Icon";
import { navFor } from "@/lib/nav";

export function PhoneNav({ news = false }: { news?: boolean }) {
  const path = usePathname();
  const items = navFor(news).filter((n) => n.phone).slice(0, 4);
  return (
    <nav className="pnav" aria-label="Main" style={{ "--n": items.length } as CSSProperties}>
      {items.map((n) => (
        <Link key={n.href} href={n.href} aria-current={(n.match ? n.match(path) : path === n.href) ? "page" : undefined}><Icon name={n.icon} />{n.label}</Link>
      ))}
    </nav>
  );
}
