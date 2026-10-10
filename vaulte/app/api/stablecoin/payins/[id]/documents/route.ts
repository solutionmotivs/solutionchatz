// POST /api/stablecoin/payins/:id/documents — supply the purpose code / invoice a held transfer is waiting for.
import { NextRequest } from "next/server";
import { z } from "zod";
import { verifyApiKey } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { attachDocuments, serializeTransfer } from "@/lib/stablecoin/service";
import { handleServiceError, readJson } from "@/lib/api-helpers";

const Schema = z.object({
  purpose_code: z.string().regex(/^[A-Z]\d{4}$/).optional(),
  invoice_id: z.string().optional(),
}).refine(v => v.purpose_code || v.invoice_id, { message: "Provide purpose_code and/or invoice_id" });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);
  if (!auth.scopes.includes("payments:write")) return apiError("FORBIDDEN", "API key missing payments:write scope", 403);
  const body = await readJson(req);
  if (body === undefined) return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  try {
    const t = await attachDocuments(auth.organizationId, params.id, { purposeCode: parsed.data.purpose_code, invoiceId: parsed.data.invoice_id });
    return apiSuccess(serializeTransfer(t));
  } catch (e) {
    return handleServiceError(e);
  }
}
