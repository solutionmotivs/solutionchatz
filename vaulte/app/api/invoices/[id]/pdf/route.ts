// GET /api/invoices/:id/pdf — download the invoice or proforma as PDF.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { renderInvoicePdf } from "@/lib/invoices/pdf";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await invoiceAuth(req, false);
  if (a.response) return a.response;
  const inv = await db.invoice.findFirst({ where: { id: params.id, organizationId: a.organizationId }, select: { id: true, number: true } });
  if (!inv) return apiError("NOT_FOUND", "Invoice not found", 404);
  const bytes = await renderInvoicePdf(inv.id);
  if (!bytes) return apiError("NOT_FOUND", "Invoice not found", 404);
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${inv.number.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`, "Cache-Control": "private, no-store" } });
}
