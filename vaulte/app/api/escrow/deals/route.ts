// POST /api/escrow/deals — create a milestone deal (escrow or pay-on-approval). GET lists them.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { body, guard } from "@/lib/escrow/api";
import { createDeal, presentDeal } from "@/lib/escrow/service";

const Schema = z.object({
  title: z.string().min(3).max(200), description: z.string().max(2000).optional(), terms: z.string().min(20).max(6000),
  mode: z.enum(["PARTNER_ESCROW", "PAY_ON_APPROVAL"]), currency: z.string().length(3).toUpperCase(), approval_window_days: z.number().int().min(3).max(30).default(7),
  seller_entity_id: z.string().optional(), purpose_code: z.string().regex(/^P\d{4}$/, "Purpose code must look like P0802").optional(),
  buyer_name: z.string().min(2).max(200), buyer_email: z.string().email(), buyer_country: z.string().length(2).toUpperCase(),
  milestones: z.array(z.object({ title: z.string().min(2).max(200), description: z.string().max(1000).optional(), amount: z.number().int().positive().max(1e12), pay_timing: z.enum(["UPFRONT", "ON_APPROVAL"]).optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional() })).min(1).max(20),
});

export async function POST(req: NextRequest) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  const p = await body(req, Schema);
  if (p.response) return p.response;
  const d = p.data;
  return guard(async () => apiSuccess(presentDeal(await createDeal(a.organizationId, {
    title: d.title, description: d.description, terms: d.terms, mode: d.mode, currency: d.currency, approvalWindowDays: d.approval_window_days, sellerEntityId: d.seller_entity_id, purposeCode: d.purpose_code,
    buyerName: d.buyer_name, buyerEmail: d.buyer_email, buyerCountry: d.buyer_country,
    milestones: d.milestones.map(m => ({ title: m.title, description: m.description, amount: m.amount, payTiming: m.pay_timing, dueDate: m.due_date })),
  })), 201));
}

export async function GET(req: NextRequest) {
  const a = await invoiceAuth(req, false);
  if (a.response) return a.response;
  const rows = await db.escrowDeal.findMany({ where: { organizationId: a.organizationId }, include: { milestones: { orderBy: { seq: "asc" } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return apiSuccess({ data: rows.map(r => presentDeal(r)) });
}
