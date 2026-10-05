// POST /api/admin/kyb/approve — staff decision on an organization's KYB (normally relayed from the partner).
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { isAdminRequest } from "@/lib/admin-auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { emitWebhookEvent } from "@/lib/webhooks/dispatch";

const Schema = z.object({
  organization_id: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED", "NEEDS_MORE_INFO"]),
  risk_tier: z.enum(["LOW", "MEDIUM", "HIGH", "BLOCKED"]).optional(),
  note: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return apiError("UNAUTHORIZED", "Admin token required", 401);
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  const d = parsed.data;

  const org = await db.organization.findUnique({ where: { id: d.organization_id }, select: { id: true, kybStatus: true } });
  if (!org) return apiError("NOT_FOUND", "Organization not found", 404);
  if (org.kybStatus === "NOT_STARTED") {
    return apiError("KYB_NOT_SUBMITTED", "Organization has not submitted KYB", 409);
  }

  await db.organization.update({
    where: { id: org.id },
    data: {
      kybStatus: d.decision,
      kybApprovedAt: d.decision === "APPROVED" ? new Date() : null,
      ...(d.risk_tier ? { riskTier: d.risk_tier } : {}),
      onboardingStep: d.decision === "APPROVED" ? "GO_LIVE" : undefined,
    },
  });
  await db.auditLog.create({
    data: { action: `kyb.${d.decision.toLowerCase()}`, resourceType: "Organization", resourceId: org.id, metadata: { note: d.note ?? null }, organizationId: org.id },
  });
  if (d.decision === "APPROVED" || d.decision === "REJECTED") {
    await emitWebhookEvent({ organizationId: org.id, event: d.decision === "APPROVED" ? "kyb.approved" : "kyb.rejected", data: { organization_id: org.id } });
  }
  return apiSuccess({ organization_id: org.id, kyb_status: d.decision });
}
