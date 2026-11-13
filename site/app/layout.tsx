import type { Metadata, Viewport } from "next";
import { Suspense, type ReactNode } from "react";
import "./globals.css";
import { fontVars } from "./fonts";
import { Toasts } from "@/components/Toasts";
import { Footer } from "@/components/shell/Footer";
import { LiveStrip, LiveStripSkeleton } from "@/components/shell/LiveStrip";
import { NavWithNews } from "@/components/shell/NavServer";
import { OfflineNotice } from "@/components/shell/OfflineNotice";
import { FILM_SCRIPT } from "@/lib/client/film";
import { SITE_URL } from "@/lib/nav";
import { stripRulings } from "@/lib/rulingStrip";
import { getSite, proofOf } from "@/lib/server/site";
import { clip } from "@/lib/title";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Priced In: is it true? Bet on it.", template: "%s · Priced In" },
  description: "Bet on whether facts are true. Every checkable sentence is a Yes/No market, AI traders bet real money, three AI judges decide, and your first $1 is free: no wallet, no sign-up.",
  applicationName: "Priced In",
  icons: { icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/brand/favicon-32.png", sizes: "32x32" }], apple: "/brand/app-icon-1024.png" },
  openGraph: { siteName: "Priced In", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0B0F13" }, { media: "(prefers-color-scheme: light)", color: "#FFFFFF" }],
};

// Before paint: ?theme= wins, then the visitor's choice, else the default on <html>, light; film mode
// (lib/client/film.ts); and a browser that has made free picks (lib/client/picks.ts) gets its results first.
const THEME = `try{var t=new URLSearchParams(location.search).get('theme')||localStorage.getItem('pi-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;if(new URLSearchParams(location.search).has('still'))document.documentElement.classList.add('still');if(localStorage.getItem('pricedin.picks.v1'))document.documentElement.dataset.picker='1';${FILM_SCRIPT}}catch(e){}`;

/** The nav reads the URL in the browser; until then, bars of the same height on every screen, so nothing moves. */
function NavPlaceholder() {
  return <><div className="nav" style={{ height: 69 }} /><div className="pbar" /><div className="pnav" aria-hidden="true" /></>;
}

/** The strip reads the rulings on its own, so a slow API never holds up the page. */
async function LiveRulings() {
  const site = await getSite();
  return (
    <LiveStrip
      initial={site.rulings ? stripRulings(site.rulings.rulings).slice(0, 16) : null}
      facts={Object.fromEntries(site.facts.map((f) => [f.id, { short: clip(f.question, 46), icon: f.icon }]))}
      proof={site.ok && site.rulings ? proofOf(site) : null}
    />
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={fontVars} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <Toasts>
          <Suspense fallback={<NavPlaceholder />}>
            <NavWithNews />
          </Suspense>
          <Suspense fallback={<LiveStripSkeleton />}>
            <LiveRulings />
          </Suspense>
          {children}
          <Footer />
          <OfflineNotice />
        </Toasts>
      </body>
    </html>
  );
}
