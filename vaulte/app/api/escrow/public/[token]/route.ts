// GET /api/escrow/public/:token — what the buyer sees at their link (no login; the unguessable link is the credential).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { publicLimited } from "@/lib/escrow/api";
import { loadDeal, presentDeal } from "@/lib/escrow/service";
import { invoiceUrls } from "@/lib/invoices/service";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  if (publicLimited(req, "view")) return apiError("RATE_LIMITED", "Slow down", 429);
  const d = await loadDeal({ publicToken: params.token });
  if (!d || d.status === "DRAFT") return apiError("NOT_FOUND", "Deal not found", 404);
  const seller = await db.entity.findUnique({ where: { id: d.sellerEntityId }, select: { legalName: true, country: true } });
  const invs = await db.invoice.findMany({ where: { id: { in: d.milestones.map(m => m.invoiceId).filter((x): x is string => !!x) } }, select: { id: true, publicToken: true, status: true } });
  const im = new Map(invs.map(i => [i.id, i]));
  const view = presentDeal(d);
  const { screening: _s, agent: _a, link: _l, ...pub } = view;
  return apiSuccess({
    ...pub, seller: seller ? { name: seller.legalName, country: seller.country } : null,
    milestones: view.milestones.map((m, n) => { const inv = d.milestones[n].invoiceId ? im.get(d.milestones[n].invoiceId!) : null; return { ...m, invoice_id: undefined, pay_url: inv && inv.status !== "PAID" ? invoiceUrls(inv.publicToken).pay_url : null, paid: inv?.status === "PAID" }; }),
  });
}
