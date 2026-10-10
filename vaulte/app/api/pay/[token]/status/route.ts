// GET /api/pay/:token/status — public polling endpoint for the pay page.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { clientIp, rateLimit } from "@/lib/security/ratelimit";
import { publicPayView } from "@/lib/stablecoin/public-view";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  if (!rateLimit(`pay-status:${clientIp(req)}`, 120, 60 * 1000)) return apiError("RATE_LIMITED", "Slow down", 429);
  const invoice = await db.invoice.findUnique({ where: { publicToken: params.token }, select: { id: true, status: true } });
  if (!invoice) return apiError("NOT_FOUND", "Invoice not found", 404);
  const t = await db.transfer.findFirst({ where: { invoiceId: invoice.id }, orderBy: { createdAt: "desc" }, include: { deposits: true } });
  if (!t) return apiSuccess({ status: invoice.status === "PAID" ? "COMPLETED" : "NONE" });
  return apiSuccess(publicPayView(t));
}
