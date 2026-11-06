import type { Metadata, Viewport } from "next";
import { Suspense, type ReactNode } from "react";
import "./globals.css";
import { fontVars } from "./fonts";
import { Toasts } from "@/components/Toasts";
import { Footer } from "@/components/shell/Footer";
import { LiveStrip, LiveStripSkeleton } from "@/components/shell/LiveStrip";
import { Nav } from "@/components/shell/Nav";
import { OfflineNotice } from "@/components/shell/OfflineNotice";
import { PhoneNav } from "@/components/shell/PhoneNav";
import { SITE_URL } from "@/lib/nav";
import { getSite } from "@/lib/server/site";

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
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0B0F13" }, { media: "(prefers-color-scheme: light)", color: "#F8F9FB" }],
};

// Before paint: ?theme= wins, then the visitor's choice, else the brand's dark default.
const THEME = `try{var t=new URLSearchParams(location.search).get('theme')||localStorage.getItem('pi-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;if(new URLSearchParams(location.search).has('still'))document.documentElement.classList.add('still')}catch(e){}`;

/** The strip reads the market on its own, so a slow API never holds up the page. */
async function LiveBets() {
  const site = await getSite();
  return (
    <LiveStrip
      initial={[...site.bets].reverse().slice(0, 16)}
      facts={Object.fromEntries(site.facts.map((f) => [f.id, { name: f.name, icon: f.icon }]))}
      agents={site.agents}
      totals={{ facts: site.totals.facts, trades: site.totals.trades, volumeUsd: site.totals.volumeUsd }}
    />
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={fontVars} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <Toasts>
          <Suspense fallback={<div className="nav" style={{ height: 69 }} />}>
            <Nav />
          </Suspense>
          <Suspense fallback={<LiveStripSkeleton />}>
            <LiveBets />
          </Suspense>
          {children}
          <Footer />
          <PhoneNav />
          <OfflineNotice />
        </Toasts>
      </body>
    </html>
  );
}
