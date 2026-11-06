// The geofence (Next.js 16 calls middleware "proxy"). Vercel sets x-vercel-ip-country and
// x-vercel-ip-country-region on every request; the rule and the list are in lib/money/geo.ts and
// data/restricted-regions.json.
//  - Every page gets a pi_geo cookie ("close_only.US"), so the money screens can say, before any tap,
//    what real money may do from here. The free $1 works everywhere, as score.
//  - The cross-chain deposit and withdrawal routes (/bridge/*) are enforced here, server-side: a new
//    deposit address is never issued to a region where money may not go in.
import { NextResponse, type NextRequest } from "next/server";
import { accessFor, canAddMoney, canTakeOut, encodeGeo, GEO_COOKIE } from "./lib/money/geo";

export function proxy(req: NextRequest) {
  const country = req.headers.get("x-vercel-ip-country");
  const region = req.headers.get("x-vercel-ip-country-region");
  const access = accessFor(country, region);
  const path = req.nextUrl.pathname;

  if (path.startsWith("/bridge/quote") && req.method === "POST") {
    const dir = req.nextUrl.searchParams.get("dir") === "out" ? "out" : "in";
    const allowed = dir === "in" ? canAddMoney(access) : canTakeOut(access);
    if (!allowed) {
      return NextResponse.json(
        { error: { code: "restricted_region", message: dir === "in" ? "Deposits aren’t available from your region." : "Withdrawals through this site aren’t available from your region." } },
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
  // pages and the bridge routes; not static files, images or the API rewrites
  matcher: ["/((?!_next/|api/|art/|brand/|fonts/|claims|events|health|lane|v1|post|favicon|.*\\.(?:png|svg|webp|avif|jpg|ico|woff2|txt|xml)$).*)"],
};
