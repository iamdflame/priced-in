// GET /bridge/status?depositAddress=&depositMemo=: where a 1Click deposit is, in its own words.
import { errorJson, status } from "@/lib/money/oneclick-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  try {
    return Response.json(await status(u.searchParams.get("depositAddress") || "", u.searchParams.get("depositMemo")), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorJson(e);
  }
}
