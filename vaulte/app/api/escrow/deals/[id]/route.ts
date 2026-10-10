import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { loadDeal, presentDeal } from "@/lib/escrow/service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await invoiceAuth(req, false);
  if (a.response) return a.response;
  const d = await loadDeal({ id: params.id, organizationId: a.organizationId });
  if (!d) return apiError("NOT_FOUND", "Deal not found", 404);
  const events = await db.escrowEvent.findMany({ where: { dealId: d.id }, orderBy: { createdAt: "asc" }, take: 500 });
  return apiSuccess(presentDeal(d, events));
}
