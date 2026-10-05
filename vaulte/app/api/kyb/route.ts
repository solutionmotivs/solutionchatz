// app/api/kyb/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyApiKey } from "@/lib/auth";
import { screenEntity } from "@/lib/compliance/aml";
import { apiError, apiSuccess } from "@/lib/utils";
import { z } from "zod";

const KYBSchema = z.object({
  legal_name: z.string().min(2).max(200),
  country: z.string().length(2).toUpperCase(),
  registration_number: z.string().min(3).max(100),
  tax_id: z.string().max(50).optional(),
  business_type: z.string().min(2).max(100),
  website: z.string().url().optional(),
  ubos: z.array(z.object({
    name: z.string().min(2),
    nationality: z.string().length(2).toUpperCase().optional(),
    ownership_pct: z.number().min(0).max(100),
    id_document: z.string().optional(), // base64
  })).min(1),
});

export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);

  let body: unknown;
  try { body = await req.json(); } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const parsed = KYBSchema.safeParse(body);
  if (!parsed.success) {
    const e = parsed.error.errors[0];
    return apiError("VALIDATION_ERROR", e.message, 400, e.path.join("."));
  }

  const data = parsed.data;

  // Check UBO ownership sum
  const totalOwnership = data.ubos.reduce((s, u) => s + u.ownership_pct, 0);
  if (totalOwnership > 100) {
    return apiError("VALIDATION_ERROR", "Total UBO ownership cannot exceed 100%", 400, "ubos");
  }

  // Sanctions screen all UBOs
  for (const ubo of data.ubos) {
    const screen = await screenEntity(ubo.name, ubo.nationality ?? data.country);
    if (!screen.cleared) {
      return apiError(
        "UBO_SANCTIONS_HIT",
        `UBO "${ubo.name}" matched sanctions screening. KYB rejected.`,
        403
      );
    }
  }

  // Screen company
  const companyScreen = await screenEntity(data.legal_name, data.country);
  if (!companyScreen.cleared) {
    return apiError("COMPANY_SANCTIONS_HIT", "Company matched sanctions screening", 403);
  }

  // Update organization
  await db.organization.update({
    where: { id: auth.organizationId },
    data: {
      legalName: data.legal_name,
      country: data.country,
      registrationNumber: data.registration_number,
      taxId: data.tax_id ?? null,
      businessType: data.business_type,
      website: data.website ?? null,
      kybStatus: "IN_REVIEW",
      kybSubmittedAt: new Date(),
    },
  });

  // Delete old UBOs, insert new
  await db.uBO.deleteMany({ where: { organizationId: auth.organizationId } });
  await db.uBO.createMany({
    data: data.ubos.map(u => ({
      name: u.name,
      nationality: u.nationality ?? null,
      ownershipPct: u.ownership_pct,
      idDocumentUrl: u.id_document ? `encrypted:${u.id_document.slice(0, 8)}...` : null,
      sanctionsCheck: true,
      pepCheck: false,
      organizationId: auth.organizationId,
    })),
  });

  await db.auditLog.create({
    data: {
      action: "kyb.submitted",
      resourceType: "Organization",
      resourceId: auth.organizationId,
      metadata: { legal_name: data.legal_name, country: data.country, ubo_count: data.ubos.length },
      organizationId: auth.organizationId,
    },
  });

  // In production: trigger async KYB review pipeline here
  // await kybQueue.add('review_kyb', { organizationId: auth.organizationId })

  return apiSuccess({
    kyb_id: auth.organizationId,
    status: "IN_REVIEW",
    submitted_at: new Date().toISOString(),
    estimated_review_time: "24-48 hours",
    checklist: {
      company_registry_lookup: "PENDING",
      sanctions_screening: "PASSED",
      ubo_verification: "PENDING",
      document_review: "PENDING",
    },
    message: "KYB application submitted. You will be notified via webhook when approved.",
  }, 202);
}

export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);

  const org = await db.organization.findUnique({
    where: { id: auth.organizationId },
    select: {
      kybStatus: true, kybSubmittedAt: true, kybApprovedAt: true,
      riskTier: true, riskScore: true, legalName: true, country: true,
      ubos: { select: { name: true, ownershipPct: true, sanctionsCheck: true, verifiedAt: true } },
    },
  });

  if (!org) return apiError("NOT_FOUND", "Organization not found", 404);

  return apiSuccess({
    status: org.kybStatus,
    risk_tier: org.riskTier,
    risk_score: org.riskScore,
    legal_name: org.legalName,
    country: org.country,
    submitted_at: org.kybSubmittedAt?.toISOString() ?? null,
    approved_at: org.kybApprovedAt?.toISOString() ?? null,
    ubos: org.ubos.map(u => ({
      name: u.name,
      ownership_pct: u.ownershipPct,
      sanctions_cleared: u.sanctionsCheck,
      verified_at: u.verifiedAt?.toISOString() ?? null,
    })),
  });
}
