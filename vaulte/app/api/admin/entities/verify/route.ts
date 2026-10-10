// POST /api/admin/entities/verify — mark a sender/recipient entity KYB/KYC verified (relayed from the partner).
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { manualOverrideAllowed, requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { activatePendingTransfers } from "@/lib/stablecoin/service";

const Schema = z.object({
  entity_id: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  verification_ref: z.string().max(100).optional(),
  pan_verified: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  if (!manualOverrideAllowed()) return apiError("OVERRIDE_DISABLED", "Manual status overrides are disabled; decide the verification case instead", 403);
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  const e = await db.entity.findUnique({ where: { id: parsed.data.entity_id } });
  if (!e) return apiError("NOT_FOUND", "Entity not found", 404);
  const updated = await db.entity.update({
    where: { id: e.id },
    data: {
      verificationStatus: parsed.data.decision,
      isVerified: parsed.data.decision === "APPROVED",
      verificationRef: parsed.data.verification_ref ?? e.verificationRef,
      ...(parsed.data.pan_verified !== undefined ? { panVerified: parsed.data.pan_verified } : {}),
    },
  });
  await db.auditLog.create({ data: { organizationId: e.organizationId, userId: staff.user.id, action: "entity.manual_verification_override", resourceType: "Entity", resourceId: e.id, metadata: { decision: parsed.data.decision } } });
  const activated = parsed.data.decision === "APPROVED" ? await activatePendingTransfers(updated.id) : 0;
  return apiSuccess({ entity_id: updated.id, verification_status: updated.verificationStatus, transfers_activated: activated });
}
