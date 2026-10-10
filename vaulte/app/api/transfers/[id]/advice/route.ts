// GET /api/transfers/:id/advice — one-page Vaulte payment advice (NOT a bank certificate).
import { NextRequest } from "next/server";
import { apiError } from "@/lib/utils";
import { loadPackData, paymentAdvicePdf } from "@/lib/documents/pdf";
import { orgContext } from "@/lib/documents/api";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const c = await orgContext(req);
  if (c.response) return c.response;
  const d = await loadPackData(params.id, c.orgId);
  if (!d) return apiError("NOT_FOUND", "Transfer not found", 404);
  return new Response(Buffer.from(await paymentAdvicePdf(d)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="payment-advice-${params.id.slice(-8)}.pdf"`, "Cache-Control": "private, no-store" } });
}
