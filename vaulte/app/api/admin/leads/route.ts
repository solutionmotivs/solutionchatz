// GET /api/admin/leads?status=NEW  — staff list.  PATCH {id, status, note} — move a lead through the pipeline.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";

const STATUSES = ["NEW", "CONTACTED", "PILOT", "PAUSED", "CLOSED"] as const;
const present = (l: { id: string; createdAt: Date; name: string; email: string; company: string; country: string; role: string | null; corridor: string | null; volumeBand: string | null; useCase: string | null; notes: string | null; status: string; staffNote: string | null; source: string | null }) => ({ id: l.id, created_at: l.createdAt.toISOString(), name: l.name, email: l.email, company: l.company, country: l.country, role: l.role, corridor: l.corridor, volume_band: l.volumeBand, use_case: l.useCase, notes: l.notes, status: l.status, staff_note: l.staffNote, source: l.source });

export async function GET(req: NextRequest) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  const status = req.nextUrl.searchParams.get("status");
  const rows = await db.pilotLead.findMany({ where: status && (STATUSES as readonly string[]).includes(status) ? { status } : {}, orderBy: { createdAt: "desc" }, take: 500 });
  const counts = Object.fromEntries(STATUSES.map(s => [s, rows.filter(r => r.status === s).length]));
  return apiSuccess({ data: rows.map(present), counts });
}

export async function PATCH(req: NextRequest) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  let raw: unknown; try { raw = await req.json(); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const p = z.object({ id: z.string(), status: z.enum(STATUSES), note: z.string().max(500).optional() }).safeParse(raw);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400);
  const l = await db.pilotLead.findUnique({ where: { id: p.data.id } });
  if (!l) return apiError("NOT_FOUND", "Lead not found", 404);
  return apiSuccess(present(await db.pilotLead.update({ where: { id: l.id }, data: { status: p.data.status, ...(p.data.note !== undefined ? { staffNote: p.data.note } : {}) } })));
}
