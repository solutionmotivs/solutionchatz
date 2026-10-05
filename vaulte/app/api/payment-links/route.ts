// POST /api/payment-links — a shareable pay link for one amount (no invoice paperwork). Optionally emails it.
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { emailInvoice } from "@/lib/invoices/email";
import { createInvoice, InvoiceError, presentInvoice } from "@/lib/invoices/service";
import { PREFIX } from "@/lib/invoices/calc";
import { db } from "@/lib/db";

const Schema = z.object({
  amount: z.number().int().positive().max(1e12),
  currency: z.string().length(3).toUpperCase(),
  description: z.string().min(1).max(300),
  issuer_entity_id: z.string().optional(),
  /** RBI purpose code (e.g. P0802): required when the payee is an Indian business. */
  purpose_code: z.string().regex(/^P\d{4}$/, "Purpose code must look like P0802").optional(),
  payer_email: z.string().email().optional(),
  payer_name: z.string().max(200).optional(),
  reference: z.string().max(100).optional(),
  send_email: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Request body must be valid JSON", 400); }
  const p = Schema.safeParse(body);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join("."));
  const d = p.data;
  if (d.send_email && !d.payer_email) return apiError("VALIDATION_ERROR", "payer_email is required to send the link by email", 400, "payer_email");
  try {
    const inv = await createInvoice(a.organizationId, {
      currency: d.currency, issuerEntityId: d.issuer_entity_id, payerEmail: d.payer_email, payerName: d.payer_name, reference: d.reference,
      lines: [{ description: d.description, quantity: 1, unit_price: d.amount, tax_rate: 0 }], source: "PAYMENT_LINK", requireIssuer: true, purposeCode: d.purpose_code, prefix: PREFIX.LINK,
    });
    // A link is live as soon as it exists.
    await db.invoice.update({ where: { id: inv.id }, data: { status: "SENT" } });
    let emailed = false;
    if (d.send_email && d.payer_email) emailed = (await emailInvoice(a.organizationId, inv.id, { email: d.payer_email, name: d.payer_name ?? d.payer_email }, a.userId)).sent;
    const fresh = await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { lineItems: true } });
    return apiSuccess({ ...presentInvoice(fresh), url: presentInvoice(fresh).pay_url, emailed }, 201);
  } catch (e) { if (e instanceof InvoiceError) return apiError(e.code, e.message, e.status, e.param); throw e; }
}
