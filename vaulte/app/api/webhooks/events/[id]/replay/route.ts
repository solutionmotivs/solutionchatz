// POST — put a delivery (failed or delivered) back in the queue; the worker sends it again with the same event id.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { integrationContext } from "@/lib/erp/api";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const c = await integrationContext(req, { manage: false });
  if (c.response) return c.response;
  const ev = await db.webhookEvent.findFirst({ where: { id: params.id, endpoint: { organizationId: c.orgId } } });
  if (!ev) return apiError("NOT_FOUND", "Event not found", 404);
  await db.webhookEvent.update({ where: { id: ev.id }, data: { attempts: 0, delivered: false, deliveredAt: null, lastError: null, nextAttemptAt: new Date() } });
  await db.auditLog.create({ data: { organizationId: c.orgId, userId: c.userId ?? null, action: "webhook.replayed", resourceType: "WebhookEvent", resourceId: ev.id } });
  return apiSuccess({ id: ev.id, queued: true });
}
