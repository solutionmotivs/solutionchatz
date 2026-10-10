// POST /api/invoices/:id/cancel — withdraw an unpaid invoice (payers can no longer pay it).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { presentInvoice } from "@/lib/invoices/service";

const OPEN_TRANSFER = ["PENDING_VERIFICATION", "AWAITING_FUNDS", "FUNDS_DETECTED", "PAYING_OUT", "QUARANTINED"] as const;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  const inv = await db.invoice.findFirst({ where: { id: params.id, organizationId: a.organizationId } });
  if (!inv) return apiError("NOT_FOUND", "Invoice not found", 404);
  if (inv.status === "PAID") return apiError("ALREADY_PAID", "A paid invoice cannot be cancelled", 409);
  if (inv.status === "CANCELLED") return apiSuccess(presentInvoice(inv));
  // Money may already be on its way: do not cancel under a payer's feet.
  const open = await db.transfer.count({ where: { invoiceId: inv.id, status: { in: [...OPEN_TRANSFER] } } });
  if (open) return apiError("PAYMENT_IN_PROGRESS", "A payment for this invoice is in progress; wait for it to finish", 409);
  return apiSuccess(presentInvoice(await db.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED" } })));
}
