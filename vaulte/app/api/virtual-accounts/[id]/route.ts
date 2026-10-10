// GET /api/virtual-accounts/:id — one account with its credits (each credit is a transfer: received, converted, paid out).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { listCredits, presentVa } from "@/lib/virtual-accounts/service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await invoiceAuth(req, false);
  if (a.response) return a.response;
  const va = await db.virtualAccount.findFirst({ where: { id: params.id, organizationId: a.organizationId }, include: { entity: { select: { legalName: true } } } });
  if (!va) return apiError("NOT_FOUND", "Virtual account not found", 404);
  return apiSuccess(presentVa(va, { holder: va.entity.legalName, credits: await listCredits(a.organizationId, va.id) }));
}
