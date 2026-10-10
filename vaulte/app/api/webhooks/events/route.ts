// GET /api/webhooks/events?status=failed|pending|delivered — delivery log (dead-lettered = failed with all attempts used).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiSuccess } from "@/lib/utils";
import { integrationContext } from "@/lib/erp/api";
import { MAX_ATTEMPTS } from "@/lib/webhooks/dispatch";

export async function GET(req: NextRequest) {
  const c = await integrationContext(req);
  if (c.response) return c.response;
  const status = req.nextUrl.searchParams.get("status") ?? "failed";
  const where = { endpoint: { organizationId: c.orgId }, ...(status === "delivered" ? { delivered: true } : status === "pending" ? { delivered: false, attempts: { lt: MAX_ATTEMPTS } } : { delivered: false, attempts: { gte: MAX_ATTEMPTS } }) };
  const rows = await db.webhookEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { endpoint: { select: { url: true } } } });
  return apiSuccess({ data: rows.map(e => ({ id: e.id, type: e.eventType, created_at: e.createdAt, attempts: e.attempts, delivered: e.delivered, last_error: e.lastError, endpoint: e.endpoint.url, dead_lettered: !e.delivered && e.attempts >= MAX_ATTEMPTS })) });
}
