// GET /api/pay/:token/pdf — the payer downloads the invoice they were sent (the unguessable link is the credential).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError } from "@/lib/utils";
import { clientIp, rateLimit } from "@/lib/security/ratelimit";
import { renderInvoicePdf } from "@/lib/invoices/pdf";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  if (!rateLimit(`pay-pdf:${clientIp(req)}`, 30, 60 * 1000)) return apiError("RATE_LIMITED", "Slow down", 429);
  const inv = await db.invoice.findUnique({ where: { publicToken: params.token }, select: { id: true, number: true, status: true } });
  if (!inv || inv.status === "DRAFT") return apiError("NOT_FOUND", "Invoice not found", 404);
  const bytes = await renderInvoicePdf(inv.id);
  if (!bytes) return apiError("NOT_FOUND", "Invoice not found", 404);
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${inv.number.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`, "Cache-Control": "private, no-store" } });
}
