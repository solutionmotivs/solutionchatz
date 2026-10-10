// GET /api/health/ready — readiness: dependencies and safety switches are in place. 503 = do not send traffic.
import { readiness } from "@/lib/health";

export const dynamic = "force-dynamic";
export async function GET() {
  const r = await readiness();
  return Response.json({ status: r.ok ? "ready" : "not_ready", checks: r.checks.map(c => ({ name: c.name, ok: c.ok, ...(c.ok ? {} : { detail: c.detail }) })) }, { status: r.ok ? 200 : 503 });
}
