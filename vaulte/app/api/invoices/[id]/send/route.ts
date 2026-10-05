// POST /api/invoices/:id/send — email the pay link to the payer.
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { emailInvoice } from "@/lib/invoices/email";
import { InvoiceError } from "@/lib/invoices/service";

const SendSchema = z.object({ recipientEmail: z.string().email(), recipientName: z.string().min(1).max(200) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Request body must be valid JSON", 400); }
  const parsed = SendSchema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  try {
    const r = await emailInvoice(a.organizationId, params.id, { email: parsed.data.recipientEmail, name: parsed.data.recipientName }, a.userId);
    return apiSuccess({ sent: r.sent, recipient_email: parsed.data.recipientEmail, pay_url: r.pay_url, invoice_status: "SENT" });
  } catch (e) { if (e instanceof InvoiceError) return apiError(e.code, e.message, e.status); throw e; }
}
