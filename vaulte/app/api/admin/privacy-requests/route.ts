// Staff: GET ?status= lists data-subject requests (oldest due first). PATCH {id, status, staff_note?, response_note?} records the outcome.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { REQUEST_STATUSES } from "@/lib/privacy-requests";

export async function GET(req: NextRequest) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  const status = req.nextUrl.searchParams.get("status");
  const rows = await db.privacyRequest.findMany({ where: status && (REQUEST_STATUSES as readonly string[]).includes(status) ? { status } : {}, orderBy: { dueAt: "asc" }, take: 300 });
  const now = Date.now();
  return apiSuccess({ data: rows.map(r => ({ id: r.id, reference: r.reference, type: r.type, region: r.region, name: r.name, email: r.email, details: r.details, account: !!r.userId, status: r.status, due_at: r.dueAt.toISOString(), overdue: !["COMPLETED", "PARTIALLY_COMPLETED", "REFUSED"].includes(r.status) && r.dueAt.getTime() < now, created_at: r.createdAt.toISOString(), staff_note: r.staffNote, response_note: r.responseNote })) });
}

export async function PATCH(req: NextRequest) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  let raw: unknown; try { raw = await req.json(); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const p = z.object({ id: z.string(), status: z.enum(REQUEST_STATUSES), staff_note: z.string().max(1000).optional(), response_note: z.string().max(1000).optional() }).safeParse(raw);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join("."));
  const r = await db.privacyRequest.findUnique({ where: { id: p.data.id } });
  if (!r) return apiError("NOT_FOUND", "Not found", 404);
  const done = ["COMPLETED", "PARTIALLY_COMPLETED", "REFUSED"].includes(p.data.status);
  if (p.data.status === "REFUSED" && !p.data.response_note) return apiError("VALIDATION_ERROR", "A refusal needs the reason given to the requester (response_note)", 400, "response_note");
  const u = await db.privacyRequest.update({ where: { id: r.id }, data: { status: p.data.status, ...(p.data.staff_note !== undefined ? { staffNote: p.data.staff_note } : {}), ...(p.data.response_note !== undefined ? { responseNote: p.data.response_note } : {}), ...(done ? { decidedAt: new Date(), decidedBy: g.user.id } : {}) } });
  await db.auditLog.create({ data: { organizationId: g.user.organizationId, userId: g.user.id, action: "privacy_request.set_status", resourceType: "PrivacyRequest", resourceId: r.id, metadata: { from: r.status, to: p.data.status, type: r.type } } });
  return apiSuccess({ id: u.id, status: u.status });
}
