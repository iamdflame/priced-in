// GET /bridge/tokens: the chains and assets money can come in from and go out to, as 1Click lists them now.
import { errorJson, routes } from "@/lib/money/oneclick-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ routes: await routes() }, { headers: { "cache-control": "public, max-age=60, s-maxage=300" } });
  } catch (e) {
    return errorJson(e);
  }
}
