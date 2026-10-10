// GET /api/partner-customers/{id}/requests: the questions the partner has for you (what it needs and where to answer).
import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { InfoRequestError, listInfoRequests } from "@/lib/partners/info-requests";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await invoiceAuth(req, false);
  if (a.response) return a.response;
  try { return apiSuccess({ data: await listInfoRequests(a.organizationId, params.id) }); }
  catch (e) { if (e instanceof InfoRequestError) return apiError(e.code, e.message, e.status); throw e; }
}
