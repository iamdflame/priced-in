// POST /bridge/quote?dir=in|out: a 1Click quote, dry (a preview) or real (with a one-time deposit
// address). proxy.ts has already refused regions where this direction of money isn't allowed.
import { errorJson, quoteIn, quoteOut } from "@/lib/money/oneclick-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const dir = new URL(req.url).searchParams.get("dir") === "out" ? "out" : "in";
  const b: any = await req.json().catch(() => ({}));
  try {
    const q = dir === "in"
      ? await quoteIn({ route: String(b.route ?? ""), amount: String(b.amount ?? ""), recipient: String(b.recipient ?? ""), refundTo: b.refundTo ? String(b.refundTo) : null, dry: b.dry !== false })
      : await quoteOut({ route: String(b.route ?? ""), amountMicro: String(b.amountMicro ?? ""), recipient: String(b.recipient ?? ""), refundTo: String(b.refundTo ?? ""), dry: b.dry !== false });
    return Response.json({ quote: q }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorJson(e);
  }
}
