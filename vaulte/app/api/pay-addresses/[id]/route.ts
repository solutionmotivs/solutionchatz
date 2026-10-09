// PATCH {status: ACTIVE | DISABLED} switches a Pay ID off or on. A disabled handle stays reserved and shows nothing publicly.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { readJson } from "@/lib/api-helpers";
import { invoiceAuth } from "@/lib/invoices/auth";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  const p = z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }).safeParse(await readJson(req));
  if (!p.success) return apiError("VALIDATION_ERROR", "status must be ACTIVE or DISABLED", 400, "status");
  const row = await db.payAddress.findFirst({ where: { id: params.id, organizationId: a.organizationId } });
  if (!row) return apiError("NOT_FOUND", "Pay ID not found", 404);
  const u = await db.payAddress.update({ where: { id: row.id }, data: { status: p.data.status } });
  await db.auditLog.create({ data: { organizationId: a.organizationId, userId: a.userId, action: "pay_address.set_status", resourceType: "PayAddress", resourceId: row.id, metadata: { to: p.data.status } } });
  return apiSuccess({ id: u.id, status: u.status });
}
