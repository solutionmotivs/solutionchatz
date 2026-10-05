// POST /api/invoices/:id/convert — turn a proforma into a numbered invoice.
import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { convertProforma, InvoiceError, presentInvoice } from "@/lib/invoices/service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  try { return apiSuccess(presentInvoice(await convertProforma(a.organizationId, params.id)), 201); }
  catch (e) { if (e instanceof InvoiceError) return apiError(e.code, e.message, e.status); throw e; }
}
