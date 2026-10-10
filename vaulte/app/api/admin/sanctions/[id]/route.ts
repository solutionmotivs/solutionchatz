// POST /api/admin/sanctions/:id — disposition an alert: CLEAR (false positive) or CONFIRM (true match).
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { parseJson } from "@/lib/kyc/api";
import { emitWebhookEvent } from "@/lib/webhooks/dispatch";

const Body = z.object({ decision: z.enum(["CLEAR", "CONFIRM"]), note: z.string().min(5).max(1000) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const p = await parseJson(req, Body);
  if (p.response) return p.response;
  const a = await db.screeningCheck.findUnique({ where: { id: params.id } });
  if (!a || a.status !== "OPEN") return apiError("NOT_FOUND", "No open alert with that id", 404);
  const status = p.data.decision === "CLEAR" ? "CLEARED" : "CONFIRMED";
  await db.screeningCheck.update({ where: { id: a.id }, data: { status, note: p.data.note, decidedById: staff.user.id, decidedAt: new Date() } });

  if (a.subjectId && ["ENTITY", "TRANSFER_PARTY", "RESCREEN", "VA_PAYER"].includes(a.subjectType)) {
    const ent = await db.entity.findUnique({ where: { id: a.subjectId } });
    if (ent) {
      if (status === "CONFIRMED") {
        await db.entity.update({ where: { id: ent.id }, data: { screeningStatus: "BLOCKED", isVerified: false } });
      } else {
        const stillOpen = await db.screeningCheck.count({ where: { subjectId: ent.id, status: "OPEN" } });
        if (!stillOpen && ent.screeningStatus === "REVIEW") await db.entity.update({ where: { id: ent.id }, data: { screeningStatus: "CLEAR" } });
      }
    }
  }
  if (status === "CONFIRMED" && a.subjectId && (a.subjectType === "CASE_SUBJECT" || a.subjectType === "CASE_PERSON" || a.subjectType === "RESCREEN")) {
    // A confirmed match on a case person or subject makes the whole case unapprovable.
    const personCase = a.subjectType === "CASE_SUBJECT" ? await db.verificationCase.findUnique({ where: { id: a.subjectId } }) : (await db.verificationPerson.findUnique({ where: { id: a.subjectId }, include: { case: true } }))?.case;
    if (personCase) await db.verificationCase.update({ where: { id: personCase.id }, data: { screening: { ...((personCase.screening as object) ?? {}), result: "BLOCK", blocked: true } } });
  }
  if (a.organizationId) {
    await db.auditLog.create({ data: { organizationId: a.organizationId, userId: staff.user.id, action: `sanctions.alert_${status.toLowerCase()}`, resourceType: "ScreeningCheck", resourceId: a.id, metadata: { note: p.data.note, subject_type: a.subjectType } } });
    if (status === "CONFIRMED") await emitWebhookEvent({ organizationId: a.organizationId, event: "compliance.flagged", data: { reason: "SANCTIONS_CONFIRMED", subject_type: a.subjectType, subject_id: a.subjectId } }).catch(() => {});
  }
  return apiSuccess({ id: a.id, status });
}
