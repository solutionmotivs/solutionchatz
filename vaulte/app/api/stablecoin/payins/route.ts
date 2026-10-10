// POST /api/stablecoin/payins — create a transfer from a quote. GET — list transfers.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyApiKey } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { createTransferFromQuote, serializeTransfer } from "@/lib/stablecoin/service";
import { handleServiceError, readJson } from "@/lib/api-helpers";

const Schema = z.object({
  quote_id: z.string(),
  purpose_code: z.string().regex(/^[A-Z]\d{4}$/, "Purpose code must look like P0802").optional(),
  invoice_id: z.string().optional(),
  idempotency_key: z.string().max(255).optional(),
  description: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);
  if (!auth.scopes.includes("payments:write")) return apiError("FORBIDDEN", "API key missing payments:write scope", 403);

  const body = await readJson(req);
  if (body === undefined) return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    const e = parsed.error.errors[0];
    return apiError("VALIDATION_ERROR", e.message, 400, e.path.join("."));
  }
  const d = parsed.data;
  try {
    if (d.invoice_id) {
      const inv = await db.invoice.findFirst({ where: { id: d.invoice_id, organizationId: auth.organizationId } });
      if (!inv) return apiError("NOT_FOUND", "Invoice not found", 404, "invoice_id");
    }
    const org = await db.organization.findUnique({ where: { id: auth.organizationId }, select: { kybStatus: true } });
    const t = await createTransferFromQuote(auth.organizationId, {
      quoteId: d.quote_id, purposeCode: d.purpose_code, invoiceId: d.invoice_id, idempotencyKey: d.idempotency_key,
      description: d.description, isSandbox: org?.kybStatus !== "APPROVED",
    });
    return apiSuccess(serializeTransfer(t), 201);
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("per_page") ?? "20")));
  const status = searchParams.get("status");
  const where = { organizationId: auth.organizationId, ...(status ? { status: status as never } : {}) };
  const [rows, total] = await Promise.all([
    db.transfer.findMany({ where, orderBy: { createdAt: "desc" }, take: perPage, skip: (page - 1) * perPage }),
    db.transfer.count({ where }),
  ]);
  return apiSuccess({ data: rows.map(serializeTransfer), total, page, per_page: perPage, has_more: total > page * perPage });
}
