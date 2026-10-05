// POST /api/admin/document-requests/:id {status: IN_PROGRESS|REJECTED|CANCELLED, note} — staff update. Fulfilment happens by adding the document.
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { docErrorResponse } from "@/lib/documents/api";
import { presentRequest, staffUpdateRequest } from "@/lib/documents/requests";

const Body = z.object({ status: z.enum(["IN_PROGRESS", "REJECTED", "CANCELLED"]), note: z.string().max(500).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const p = Body.safeParse(body);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400);
  try { return apiSuccess(presentRequest(await staffUpdateRequest(params.id, g.user.id, p.data.status, p.data.note))); }
  catch (e) { const r = docErrorResponse(e); if (r) return r; throw e; }
}
