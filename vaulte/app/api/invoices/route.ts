// POST /api/invoices — create an invoice or proforma (dashboard session or API key). GET lists them.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { CreateInvoiceSchema } from "@/lib/invoices/schema";
import { createInvoice, InvoiceError, presentInvoice } from "@/lib/invoices/service";

export async function POST(req: NextRequest) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Request body must be valid JSON", 400); }
  const p = CreateInvoiceSchema.safeParse(body);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join("."));
  const d = p.data;
  try {
    const inv = await createInvoice(a.organizationId, {
      kind: d.kind, number: d.number, currency: d.currency, issuerEntityId: d.issuer_entity_id, payerEntityId: d.payer_entity_id,
      payerName: d.payer_name, payerEmail: d.payer_email, payerAddress: d.payer_address, payerTaxId: d.payer_tax_id, reference: d.reference,
      dueDate: d.due_date, notes: d.notes, purposeCode: d.purpose_code, source: a.via === "key" ? "API" : "DASHBOARD",
      lines: d.line_items.map(l => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, tax_rate: l.tax_rate })),
    });
    return apiSuccess(presentInvoice(inv), 201);
  } catch (e) {
    if (e instanceof InvoiceError) return apiError(e.code, e.message, e.status, e.param);
    throw e;
  }
}

export async function GET(req: NextRequest) {
  const a = await invoiceAuth(req, false);
  if (a.response) return a.response;
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status"), kind = sp.get("kind");
  const page = Math.max(1, parseInt(sp.get("page") ?? "1") || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(sp.get("per_page") ?? "20") || 20));
  const where = {
    organizationId: a.organizationId,
    ...(status ? { status: status as import("@prisma/client").InvoiceStatus } : {}),
    ...(kind === "INVOICE" || kind === "PROFORMA" ? { kind: kind as "INVOICE" | "PROFORMA" } : {}),
  };
  const [rows, total] = await Promise.all([
    db.invoice.findMany({ where, orderBy: { createdAt: "desc" }, take: perPage, skip: (page - 1) * perPage }),
    db.invoice.count({ where }),
  ]);
  return apiSuccess({ data: rows.map(r => presentInvoice(r)), has_more: total > page * perPage, total, page, per_page: perPage });
}
