// A business claims its Pay ID (acme@vaulte): GET lists, POST {handle, entity_id, tagline?} claims one for a VERIFIED entity (one per entity).
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { readJson } from "@/lib/api-helpers";
import { invoiceAuth } from "@/lib/invoices/auth";
import { hit } from "@/lib/security/ratelimit-db";
import { formatHandle, normaliseHandle, validateHandle } from "@/lib/pay-address";

const present = (r: { id: string; handle: string; status: string; entityId: string; tagline: string | null; createdAt: Date; entity?: { legalName: string } }, base: string) => ({ id: r.id, handle: r.handle, address: formatHandle(r.handle), url: `${base}/id/${r.handle}`, status: r.status, entity_id: r.entityId, holder: r.entity?.legalName, tagline: r.tagline, created_at: r.createdAt.toISOString() });
const base = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://vaulte.iaexnetwork.com").replace(/\/$/, "");

export async function GET(req: NextRequest) {
  const a = await invoiceAuth(req, false);
  if (a.response) return a.response;
  const rows = await db.payAddress.findMany({ where: { organizationId: a.organizationId }, include: { entity: { select: { legalName: true } } }, orderBy: { createdAt: "desc" } });
  return apiSuccess({ data: rows.map(r => present(r, base())) });
}

export async function POST(req: NextRequest) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  if (!(await hit(`payid:${a.organizationId}`, 10, 3600)).allowed) return apiError("RATE_LIMITED", "Too many attempts. Try again later.", 429);
  const p = z.object({ handle: z.string().min(1).max(60), entity_id: z.string().min(1), tagline: z.string().trim().max(120).optional() }).safeParse(await readJson(req));
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join("."));
  const handle = normaliseHandle(p.data.handle);
  const bad = validateHandle(handle);
  if (bad) return apiError("INVALID_HANDLE", bad, 400, "handle");
  const entity = await db.entity.findFirst({ where: { id: p.data.entity_id, organizationId: a.organizationId } });
  if (!entity) return apiError("NOT_FOUND", "Entity not found", 404, "entity_id");
  if (entity.verificationStatus !== "APPROVED") return apiError("ENTITY_NOT_VERIFIED", "Only a verified account holder can have a Pay ID: the public page shows the verified name", 422, "entity_id");
  if (await db.payAddress.findUnique({ where: { entityId: entity.id } })) return apiError("ALREADY_EXISTS", "This account holder already has a Pay ID", 409);
  if (await db.payAddress.findUnique({ where: { handle } })) return apiError("HANDLE_TAKEN", "That handle is taken", 409, "handle");
  const row = await db.payAddress.create({ data: { handle, organizationId: a.organizationId, entityId: entity.id, tagline: p.data.tagline ?? null }, include: { entity: { select: { legalName: true } } } });
  await db.auditLog.create({ data: { organizationId: a.organizationId, userId: a.userId, action: "pay_address.claimed", resourceType: "PayAddress", resourceId: row.id, metadata: { handle } } });
  return apiSuccess(present(row, base()), 201);
}
