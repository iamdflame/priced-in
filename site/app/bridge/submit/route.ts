// POST /bridge/submit {depositAddress, txHash}: tells 1Click a deposit was sent, so it starts sooner.
import { errorJson, submit } from "@/lib/money/oneclick-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b: any = await req.json().catch(() => ({}));
  try {
    await submit(String(b.depositAddress ?? ""), String(b.txHash ?? ""));
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorJson(e);
  }
}
