import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { body, guard } from "@/lib/escrow/api";
import { submitMilestone } from "@/lib/escrow/service";

export async function POST(req: NextRequest, { params }: { params: { id: string; mid: string } }) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  const p = await body(req, z.object({ note: z.string().max(1000).optional() }));
  if (p.response) return p.response;
  return guard(async () => { await submitMilestone(a.organizationId, params.id, params.mid, p.data.note); return apiSuccess({ status: "SUBMITTED" }); });
}
