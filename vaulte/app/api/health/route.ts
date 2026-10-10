// GET /api/health — liveness: the process is up. Use for container restarts.
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ status: "ok", time: new Date().toISOString() });
}
