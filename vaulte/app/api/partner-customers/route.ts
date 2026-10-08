// The customer's onboarding at each licensed partner. GET lists it; POST {partner} starts it (Vaulte sends the verified KYB package; the partner decides).
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { readJson } from "@/lib/api-helpers";
import { invoiceAuth } from "@/lib/invoices/auth";
import { submitToPartner } from "@/lib/partners/customers";
import { getPartner } from "@/lib/psp/stablecoin/registry";

const present = (r: { id: string; partner: string; sandbox: boolean; status: string; note: string | null; submittedAt: Date | null; decidedAt: Date | null }) => ({ id: r.id, partner: r.partner, mode: r.sandbox ? "test" : "live", status: r.status, note: r.note, submitted_at: r.submittedAt?.toISOString() ?? null, decided_at: r.decidedAt?.toISOString() ?? null });

export async function GET(req: NextRequest) {
  const a = await invoiceAuth(req, false);
  if (a.response) return a.response;
  const rows = await db.partnerCustomer.findMany({ where: { organizationId: a.organizationId }, orderBy: { updatedAt: "desc" } });
  return apiSuccess({ data: rows.map(present), note: "Licensed partners decide whether to accept you; Vaulte sends them your verified details. Live payments through a partner need APPROVED." });
}

export async function POST(req: NextRequest) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  const body = await readJson(req);
  const p = z.object({ partner: z.string().min(2).max(60) }).safeParse(body);
  if (!p.success) return apiError("VALIDATION_ERROR", "partner is required", 400, "partner");
  const org = await db.organization.findUniqueOrThrow({ where: { id: a.organizationId }, select: { kybStatus: true } });
  const sandbox = org.kybStatus !== "APPROVED";
  try { getPartner(p.data.partner); } catch { return apiError("UNKNOWN_PARTNER", "No such partner", 404, "partner"); }
  return apiSuccess(present(await submitToPartner(a.organizationId, p.data.partner, sandbox)), 201);
}
