// Staff: GET ?status=SUBMITTED lists partner onboarding rows. PATCH {id, status, partner_ref?, note?} records the partner's decision when the partner has no API.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { PARTNER_STATUSES } from "@/lib/partners/customers";

export async function GET(req: NextRequest) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  const status = req.nextUrl.searchParams.get("status");
  const rows = await db.partnerCustomer.findMany({ where: status && (PARTNER_STATUSES as readonly string[]).includes(status) ? { status } : {}, include: { organization: { select: { name: true, legalName: true, country: true } } }, orderBy: { updatedAt: "desc" }, take: 300 });
  return apiSuccess({ data: rows.map(r => ({ id: r.id, organization: r.organization.legalName ?? r.organization.name, country: r.organization.country, partner: r.partner, mode: r.sandbox ? "test" : "live", status: r.status, partner_ref: r.partnerRef, note: r.note, updated_at: r.updatedAt.toISOString() })) });
}

export async function PATCH(req: NextRequest) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  let raw: unknown; try { raw = await req.json(); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const p = z.object({ id: z.string(), status: z.enum(PARTNER_STATUSES), partner_ref: z.string().max(120).optional(), note: z.string().max(500).optional() }).safeParse(raw);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join("."));
  const r = await db.partnerCustomer.findUnique({ where: { id: p.data.id } });
  if (!r) return apiError("NOT_FOUND", "Not found", 404);
  const decided = p.data.status === "APPROVED" || p.data.status === "REJECTED";
  const u = await db.partnerCustomer.update({ where: { id: r.id }, data: { status: p.data.status, ...(p.data.partner_ref ? { partnerRef: p.data.partner_ref } : {}), ...(p.data.note !== undefined ? { note: p.data.note } : {}), ...(decided ? { decidedAt: new Date(), decidedBy: g.user.id } : {}) } });
  await db.auditLog.create({ data: { organizationId: r.organizationId, userId: g.user.id, action: "partner_customer.set_status", resourceType: "PartnerCustomer", resourceId: r.id, metadata: { from: r.status, to: p.data.status, partner: r.partner } } });
  return apiSuccess({ id: u.id, status: u.status });
}
