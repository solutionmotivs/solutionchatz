// Where a recipient is paid. GET lists (masked); POST adds one. India: IFSC + account number, and/or a UPI ID (instant to a VPA).
// The licensed payout partner verifies the account or UPI ID before paying; Vaulte only checks the format.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { readJson } from "@/lib/api-helpers";
import { invoiceAuth } from "@/lib/invoices/auth";
import { mask, validateIban, validateIfsc } from "@/lib/kyc/validators";
import { validateUpiId } from "@/lib/routing/india-rails";

const Schema = z.object({
  account_name: z.string().trim().min(2).max(200),
  currency: z.string().trim().toUpperCase().length(3),
  country: z.string().trim().toUpperCase().length(2),
  iban: z.string().trim().max(40).optional(),
  swift_bic: z.string().trim().max(11).optional(),
  account_number: z.string().trim().max(40).optional(),
  routing_number: z.string().trim().max(20).optional(),
  sort_code: z.string().trim().max(10).optional(),
  ifsc: z.string().trim().toUpperCase().max(11).optional(),
  upi_id: z.string().trim().max(100).optional(),
  alias: z.string().trim().max(60).optional(),
});

const present = (b: { id: string; alias: string | null; accountName: string; currency: string; country: string; iban: string | null; accountNumber: string | null; ifsc: string | null; upiId: string | null; isVerified: boolean }) => ({
  id: b.id, alias: b.alias, account_name: b.accountName, currency: b.currency, country: b.country,
  iban: b.iban ? mask(b.iban) : null, account_number: b.accountNumber ? mask(b.accountNumber) : null, ifsc: b.ifsc, upi_id: b.upiId ? mask(b.upiId) : null, verified: b.isVerified,
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await invoiceAuth(req, false);
  if (a.response) return a.response;
  const entity = await db.entity.findFirst({ where: { id: params.id, organizationId: a.organizationId }, select: { id: true } });
  if (!entity) return apiError("NOT_FOUND", "Entity not found", 404);
  return apiSuccess({ data: (await db.bankAccount.findMany({ where: { entityId: entity.id }, orderBy: { createdAt: "desc" } })).map(present) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  const entity = await db.entity.findFirst({ where: { id: params.id, organizationId: a.organizationId }, select: { id: true, isSandbox: true } });
  if (!entity) return apiError("NOT_FOUND", "Entity not found", 404);
  const body = await readJson(req);
  if (body === undefined) return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  const p = Schema.safeParse(body);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join("."));
  const d = p.data;
  if (d.country === "IN") {
    const bankOk = !!d.ifsc && !!d.account_number;
    if (!bankOk && !d.upi_id) return apiError("VALIDATION_ERROR", "India: give an IFSC with an account number, or a UPI ID", 400);
    if (d.ifsc || d.account_number) {
      const e = validateIfsc(d.ifsc ?? "") ?? (/^[0-9]{6,20}$/.test(d.account_number ?? "") ? null : "Indian account numbers have 6-20 digits");
      if (e) return apiError("VALIDATION_ERROR", e, 400, d.ifsc && !e.includes("account") ? "ifsc" : "account_number");
    }
    if (d.upi_id) { const e = validateUpiId(d.upi_id); if (e) return apiError("VALIDATION_ERROR", e, 400, "upi_id"); }
    if (d.currency !== "INR") return apiError("VALIDATION_ERROR", "Indian accounts are paid in INR", 400, "currency");
  } else {
    if (!d.iban && !d.account_number) return apiError("VALIDATION_ERROR", "Give an IBAN or an account number", 400);
    if (d.iban) { const e = validateIban(d.iban); if (e) return apiError("VALIDATION_ERROR", e, 400, "iban"); }
    if (d.upi_id || d.ifsc) return apiError("VALIDATION_ERROR", "IFSC and UPI IDs are only for India", 400);
  }
  const row = await db.bankAccount.create({
    data: {
      entityId: entity.id, accountName: d.account_name, currency: d.currency, country: d.country, alias: d.alias ?? null,
      iban: d.iban?.replace(/\s+/g, "").toUpperCase() ?? null, swiftBic: d.swift_bic?.toUpperCase() ?? null, accountNumber: d.account_number ?? null,
      routingNumber: d.routing_number ?? null, sortCode: d.sort_code ?? null, ifsc: d.ifsc ?? null, upiId: d.upi_id?.toLowerCase() ?? null, isSandbox: entity.isSandbox,
    },
  });
  await db.auditLog.create({ data: { organizationId: a.organizationId, userId: a.userId ?? null, action: "bank_account.add", resourceType: "BankAccount", resourceId: row.id, metadata: { entityId: entity.id, country: d.country, currency: d.currency } } });
  return apiSuccess(present(row), 201);
}
