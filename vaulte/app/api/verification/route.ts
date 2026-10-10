// GET /api/verification — cases for the signed-in organization. POST — start (or resume) one.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { createCase, presentCase } from "@/lib/kyc/service";
import { EDIT_ROLES, handleError, parseJson } from "@/lib/kyc/api";

export async function GET(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  const cases = await db.verificationCase.findMany({
    where: { organizationId: g.user.organizationId }, orderBy: { createdAt: "desc" }, take: 100,
    include: { entity: { select: { legalName: true } } },
  });
  return apiSuccess({
    data: cases.map(c => ({
      id: c.id, kind: c.kind, subject_type: c.subjectType, entity_id: c.entityId, subject_name: c.entity?.legalName ?? null,
      country: c.country, purposes: c.purposes, status: c.status, tier: c.tier, submitted_at: c.submittedAt, decided_at: c.decidedAt, next_review_at: c.nextReviewAt,
    })),
  });
}

const Create = z.object({ entity_id: z.string().optional(), purposes: z.array(z.string()).min(1).max(8) });

export async function POST(req: NextRequest) {
  const g = await requireUser(req, { roles: [...EDIT_ROLES] });
  if (g.response) return g.response;
  const p = await parseJson(req, Create);
  if (p.response) return p.response;
  try {
    const c = await createCase({ organizationId: g.user.organizationId, entityId: p.data.entity_id, purposes: p.data.purposes, actorId: g.user.id });
    return apiSuccess(presentCase(c), 201);
  } catch (e) { return handleError(e); }
}
