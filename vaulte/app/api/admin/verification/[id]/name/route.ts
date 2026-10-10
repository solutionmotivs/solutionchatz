// POST /api/admin/verification/:id/name {target: "profile"|<personId>, name, note} — a named staff member sets a name after reading the documents.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { audit, loadCase } from "@/lib/kyc/service";

const Schema = z.object({ target: z.string().min(1), name: z.string().min(2).max(200), note: z.string().min(10).max(500) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  let raw: unknown; try { raw = await req.json(); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const p = Schema.safeParse(raw);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join("."));
  const c = await loadCase(params.id);
  if (!c) return apiError("NOT_FOUND", "Case not found", 404);
  if (["APPROVED", "REJECTED"].includes(c.status)) return apiError("CLOSED", "A decided case cannot be changed", 409);
  if (p.data.target === "profile") {
    const prof = { ...((c.profile ?? {}) as Record<string, unknown>) };
    if (prof.legal_name && prof.legal_name !== p.data.name) prof.legal_name_entered = prof.legal_name;
    prof.legal_name = p.data.name.trim(); prof.legal_name_source = "STAFF";
    await db.verificationCase.update({ where: { id: c.id }, data: { profile: prof as never } });
  } else {
    const person = c.people.find(x => x.id === p.data.target);
    if (!person) return apiError("NOT_FOUND", "Person not found", 404);
    await db.verificationPerson.update({ where: { id: person.id }, data: { fullName: p.data.name.trim(), nameSource: "STAFF", nameEntered: person.fullName !== p.data.name.trim() ? person.fullName : person.nameEntered } });
  }
  await audit(c.organizationId, g.user.id, "verification.name_set_by_staff", c.id, { target: p.data.target === "profile" ? "profile" : "person", note: p.data.note });
  return apiSuccess({ ok: true });
}
