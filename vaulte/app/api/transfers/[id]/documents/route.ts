// GET /api/transfers/:id/documents — documents on file plus what this transfer is still expected to have.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { checklistFor } from "@/lib/documents/types";
import { presentDocument } from "@/lib/documents/service";
import { orgContext } from "@/lib/documents/api";
import { REQUESTABLE } from "@/lib/documents/requests";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const c = await orgContext(req);
  if (c.response) return c.response;
  const t = await db.transfer.findFirst({ where: { id: params.id, organizationId: c.orgId } });
  if (!t) return apiError("NOT_FOUND", "Transfer not found", 404);
  const docs = await db.document.findMany({ where: { transferId: t.id, organizationId: c.orgId }, orderBy: { createdAt: "asc" } });
  const checklist = checklistFor(t, docs);
  const requestable = t.status === "COMPLETED" ? REQUESTABLE.filter(r => (t.destCountry === "IN" || r === "BANK_CERT") && !docs.some(d => d.type === r && d.status !== "REJECTED")) : [];
  return apiSuccess({ data: docs.map(presentDocument), checklist, auto_update: { last_checked_at: t.certCheckedAt?.toISOString() ?? null, note: t.certCheckNote, how: "We ask the payout partner for certificates on a schedule and file anything that arrives by email from your bank or partner. Nothing here is issued by Vaulte." }, requestable, complete: checklist.filter(i => i.required).every(i => i.status !== "PENDING"), retention_note: "Keep these records for at least the period your regulator and tax law require (commonly 5-8 years); confirm with your advisers." });
}
