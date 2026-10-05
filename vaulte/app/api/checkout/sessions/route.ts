// POST /api/checkout/sessions — hosted checkout for e-commerce: create a session server-side, redirect the buyer to `url`,
// then rely on the invoice.paid webhook (or GET the session) to fulfil the order.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { createInvoice, InvoiceError } from "@/lib/invoices/service";
import { PREFIX } from "@/lib/invoices/calc";
import { presentSession } from "./present";

const Schema = z.object({
  currency: z.string().length(3).toUpperCase(),
  amount: z.number().int().positive().max(1e12).optional(),
  description: z.string().max(300).optional(),
  line_items: z.array(z.object({ description: z.string().min(1).max(300), quantity: z.number().positive().max(1e9).default(1), unit_price: z.number().int().min(0).max(1e12), tax_rate: z.number().min(0).max(100).default(0) })).min(1).max(100).optional(),
  success_url: z.string().url().max(2000).optional(),
  cancel_url: z.string().url().max(2000).optional(),
  customer_email: z.string().email().optional(),
  customer_name: z.string().max(200).optional(),
  client_reference_id: z.string().max(100).optional(),
  issuer_entity_id: z.string().optional(),
  /** RBI purpose code (e.g. P0802): required when the payee is an Indian business. */
  purpose_code: z.string().regex(/^P\d{4}$/, "Purpose code must look like P0802").optional(),
}).refine(v => v.amount || v.line_items, { message: "Provide amount or line_items" });

export async function POST(req: NextRequest) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  if (a.via !== "key") return apiError("API_KEY_REQUIRED", "Checkout sessions are created server-side with an API key", 403);
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Request body must be valid JSON", 400); }
  const p = Schema.safeParse(body);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join("."));
  const d = p.data;
  try {
    const inv = await createInvoice(a.organizationId, {
      currency: d.currency, issuerEntityId: d.issuer_entity_id, payerEmail: d.customer_email, payerName: d.customer_name, reference: d.client_reference_id,
      lines: d.line_items?.map(l => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, tax_rate: l.tax_rate })) ?? [{ description: d.description ?? "Order", quantity: 1, unit_price: d.amount!, tax_rate: 0 }],
      successUrl: d.success_url, cancelUrl: d.cancel_url, source: "CHECKOUT", requireIssuer: true, purposeCode: d.purpose_code, prefix: PREFIX.CHECKOUT,
    });
    const live = await db.invoice.update({ where: { id: inv.id }, data: { status: "SENT" } });
    return apiSuccess(presentSession(live), 201);
  } catch (e) { if (e instanceof InvoiceError) return apiError(e.code, e.message, e.status, e.param); throw e; }
}
