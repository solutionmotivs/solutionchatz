// GET/POST /api/transfers/:id/document-requests — ask for an eFIRA / FIRC / eBRC / BRC / bank certificate.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { orgContext, docErrorResponse } from "@/lib/documents/api";
import { createRequest, presentRequest, REQUESTABLE } from "@/lib/documents/requests";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const c = await orgContext(req);
  if (c.response) return c.response;
  const rows = await db.documentRequest.findMany({ where: { organizationId: c.orgId, transferId: params.id }, orderBy: { createdAt: "desc" } });
  return apiSuccess({ data: rows.map(presentRequest), requestable: REQUESTABLE });
}

const Body = z.object({ type: z.string().min(1).max(20), note: z.string().max(500).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const c = await orgContext(req, { write: true });
  if (c.response) return c.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const p = Body.safeParse(body);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400);
  try {
    const r = await createRequest(c.orgId, params.id, p.data.type.toUpperCase(), p.data.note, c.userId);
    return apiSuccess({ ...presentRequest(r.request), already_requested: !r.created }, r.created ? 201 : 200);
  } catch (e) { const r = docErrorResponse(e); if (r) return r; throw e; }
}
