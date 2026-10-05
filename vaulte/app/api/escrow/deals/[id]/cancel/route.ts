import { NextRequest } from "next/server";
import { apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { guard } from "@/lib/escrow/api";
import { cancelDeal } from "@/lib/escrow/service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  return guard(async () => { await cancelDeal(a.organizationId, params.id); return apiSuccess({ status: "CANCELLED" }); });
}
