import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { body, guard } from "@/lib/escrow/api";
import { disputeMilestone } from "@/lib/escrow/service";

export async function POST(req: NextRequest, { params }: { params: { id: string; mid: string } }) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  const p = await body(req, z.object({ reason: z.string().min(1).max(1500) }));
  if (p.response) return p.response;
  return guard(async () => { await disputeMilestone(params.mid, "SELLER", p.data.reason, { organizationId: a.organizationId }); return apiSuccess({ status: "DISPUTED" }); });
}
