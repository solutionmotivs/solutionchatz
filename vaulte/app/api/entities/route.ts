// app/api/entities/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser, verifyApiKey } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { z } from "zod";
import { screenAndFlagEntity } from "@/lib/sanctions/entities";

const EntitySchema = z.object({
  legalName: z.string().min(2).max(200),
  country: z.string().length(2).toUpperCase(),
  currency: z.string().length(3).toUpperCase(),
  registrationNo: z.string().optional(),
  taxId: z.string().optional(),
  isSandbox: z.boolean().default(false),
});

async function getOrgId(req: NextRequest): Promise<string | null> {
  const user = await getAuthUser();
  if (user) return user.organizationId;
  const apiAuth = await verifyApiKey(req.headers.get("authorization"));
  if (apiAuth) return apiAuth.organizationId;
  return null;
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req);
  if (!orgId) return apiError("UNAUTHORIZED", "Not authenticated", 401);

  const body = await req.json();
  const parsed = EntitySchema.safeParse(body);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  }

  const entity = await db.entity.create({
    data: {
      legalName: parsed.data.legalName,
      country: parsed.data.country,
      currency: parsed.data.currency,
      registrationNo: parsed.data.registrationNo ?? null,
      taxId: parsed.data.taxId ?? null,
      isSandbox: parsed.data.isSandbox,
      organizationId: orgId,
    },
  });

  // Sanctions screening: a confirmed match is refused outright (no detail is given to the customer);
  // a possible match is created but held until compliance staff clear it.
  const screened = await screenAndFlagEntity(entity, "ENTITY");
  if (screened === "BLOCK") {
    await db.entity.delete({ where: { id: entity.id } }); // the screening record stays; the party is not stored
    return apiError("PARTY_NOT_ACCEPTED", "We cannot onboard this party. Contact support if you believe this is a mistake.", 403);
  }

  // Auto-create sandbox recipient if first entity
  if (parsed.data.isSandbox) {
    const existing = await db.entity.count({ where: { organizationId: orgId, isSandbox: true } });
    if (existing <= 1) {
      await db.entity.create({
        data: {
          legalName: "Vaulte Test Recipient Co.",
          country: "US",
          currency: "USD",
          isSandbox: true,
          organizationId: orgId,
        },
      });
    }

    // Advance onboarding step
    await db.organization.update({
      where: { id: orgId },
      data: { onboardingStep: "FIRST_PAYMENT" },
    });
  }

  return apiSuccess({ id: entity.id, legalName: entity.legalName, country: entity.country, currency: entity.currency }, 201);
}

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req);
  if (!orgId) return apiError("UNAUTHORIZED", "Not authenticated", 401);

  const entities = await db.entity.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "asc" },
  });

  return apiSuccess({
    data: entities.map(e => ({
      id: e.id,
      legalName: e.legalName,
      country: e.country,
      currency: e.currency,
      isVerified: e.isVerified,
      isSandbox: e.isSandbox,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}
