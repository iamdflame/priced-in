// The site's front door (Next.js 16 calls middleware "proxy"). It does two jobs, each with its rule in
// its own module:
//  - Forwarded API requests carry the visitor's address to the API (lib/proxy/forward.ts).
//  - Real money follows the region (lib/money/geo.ts, data/restricted-regions.json). Every page sets
//    the pi_geo cookie, so the money screens say what real money may do from here before any tap, and
//    /bridge/quote is refused here, server-side, where that direction of money isn't allowed.
import { NextResponse, type NextRequest } from "next/server";
import { accessFor, canAddMoney, canTakeOut, encodeGeo, GEO_COOKIE } from "./lib/money/geo";
import { forwardHeaders, isApiPath } from "./lib/proxy/forward";

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (isApiPath(path)) return NextResponse.next({ request: { headers: forwardHeaders(req.headers, process.env.PROXY_SECRET) } });

  const country = req.headers.get("x-vercel-ip-country");
  const access = accessFor(country, req.headers.get("x-vercel-ip-country-region"), { required: Boolean(process.env.VERCEL) });

  if (path === "/bridge/quote" && req.method === "POST") {
    const out = req.nextUrl.searchParams.get("dir") === "out";
    if (!(out ? canTakeOut(access) : canAddMoney(access))) {
      return NextResponse.json(
        { error: { code: "restricted_region", message: out ? "Withdrawals through this site aren’t available from your region." : "Deposits aren’t available from your region." } },
        { status: 451 },
      );
    }
  }

  const res = NextResponse.next();
  const value = encodeGeo(access, country);
  if (req.cookies.get(GEO_COOKIE)?.value !== value) {
    res.cookies.set(GEO_COOKIE, value, { path: "/", sameSite: "lax", secure: req.nextUrl.protocol === "https:", maxAge: 60 * 60 });
  }
  return res;
}

export const config = {
  // The API paths are listed one by one (the same list as API_PATHS, which a test holds them to; a
  // matcher must be a literal), so none can slip past on a file-like name. Then pages and /bridge.
  matcher: [
    "/api/:path*", "/health/:path*", "/claims/:path*", "/events/:path*", "/lane/:path*", "/v1/:path*", "/post/:path*",
    "/((?!_next/|.*\\.(?:png|svg|webp|avif|jpg|ico|woff2|txt|xml)$).*)",
  ],
};
