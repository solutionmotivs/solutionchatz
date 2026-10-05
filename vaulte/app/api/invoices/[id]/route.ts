import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { presentInvoice } from "@/lib/invoices/service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await invoiceAuth(req, false);
  if (a.response) return a.response;
  const inv = await db.invoice.findFirst({ where: { id: params.id, organizationId: a.organizationId }, include: { lineItems: true } });
  if (!inv) return apiError("NOT_FOUND", "Invoice not found", 404);
  return apiSuccess(presentInvoice(inv));
}
