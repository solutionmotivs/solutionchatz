import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { orgContext } from "@/lib/documents/api";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const c = await orgContext(req, { write: true });
  if (c.response) return c.response;
  const r = await db.webhookEndpoint.deleteMany({ where: { id: params.id, organizationId: c.orgId } });
  if (!r.count) return apiError("NOT_FOUND", "Webhook endpoint not found", 404);
  return apiSuccess({ deleted: true });
}
