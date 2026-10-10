// POST /api/pay/:token/intent — public (no login). A payer chooses USDC/USDT; we create a transfer
// whose funding instructions come from the licensed partner. Rate-limited; guests are verified by the partner.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { clientIp, rateLimit } from "@/lib/security/ratelimit";
import { readJson, handleServiceError } from "@/lib/api-helpers";
import { createQuoteForDestination, createTransferFromQuote, ServiceError } from "@/lib/stablecoin/service";
import { publicPayView } from "@/lib/stablecoin/public-view";
import { TOKEN_PEG, type Token } from "@/lib/stablecoin/types";

const Schema = z.object({
  payer_name: z.string().min(2).max(200),
  payer_country: z.string().length(2).toUpperCase(),
  payer_email: z.string().email(),
  /** Stablecoin (default) or a bank transfer in the payer's own currency, routed through a licensed partner. */
  method: z.enum(["STABLECOIN", "BANK_TRANSFER"]).default("STABLECOIN"),
  token: z.enum(["USDC", "USDT", "EURC"]).optional(),
  source_currency: z.string().length(3).toUpperCase().optional(),
}).refine(v => v.method === "BANK_TRANSFER" || !!v.token, { message: "Choose USDC, USDT or EURC", path: ["token"] });

const OPEN = ["PENDING_VERIFICATION", "AWAITING_FUNDS", "FUNDS_DETECTED", "PAYING_OUT", "QUARANTINED"] as const;

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!rateLimit(`pay-intent:${clientIp(req)}`, Number(process.env.PAY_INTENT_RATE_LIMIT ?? 8), 10 * 60 * 1000)) {
    return apiError("RATE_LIMITED", "Too many attempts. Please try again later.", 429);
  }
  const body = await readJson(req);
  if (body === undefined) return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400, parsed.error.errors[0].path.join("."));
  const d = parsed.data;

  const invoice = await db.invoice.findUnique({ where: { publicToken: params.token }, include: { organization: { select: { kybStatus: true } } } });
  if (!invoice) return apiError("NOT_FOUND", "Invoice not found", 404);
  if (invoice.status === "PAID" || invoice.status === "CANCELLED" || invoice.status === "DRAFT") {
    return apiError("NOT_PAYABLE", "This invoice cannot be paid", 409);
  }
  if (!invoice.issuerEntityId) {
    return apiError("NOT_CONFIGURED", "The sender has not set up payouts for this invoice yet", 409);
  }

  // One open payment per invoice: return it instead of creating a second one.
  const open = await db.transfer.findFirst({ where: { invoiceId: invoice.id, status: { in: [...OPEN] } }, orderBy: { createdAt: "desc" }, include: { deposits: true } });
  if (open) return apiSuccess(publicPayView(open));

  const guests = await db.entity.count({ where: { organizationId: invoice.organizationId, verificationRef: `guest:${invoice.id}` } });
  if (guests >= 5) return apiError("RATE_LIMITED", "Too many payer registrations for this invoice", 429);

  const bank = d.method === "BANK_TRANSFER";
  try {
    const payer = await db.entity.create({
      data: {
        legalName: d.payer_name, country: d.payer_country, currency: bank ? (d.source_currency ?? "USD") : TOKEN_PEG[d.token as Token], entityType: "BUSINESS",
        verificationStatus: "NOT_STARTED", verificationRef: `guest:${invoice.id}`,
        isSandbox: invoice.organization.kybStatus !== "APPROVED", organizationId: invoice.organizationId,
      },
    });
    const { row } = await createQuoteForDestination(invoice.organizationId, {
      kind: "BUSINESS", senderEntityId: payer.id, recipientEntityId: invoice.issuerEntityId,
      sourceCurrency: bank ? (d.source_currency ?? "USD") : TOKEN_PEG[d.token as Token], destCurrency: invoice.currency, destAmount: Number(invoice.totalAmount),
      fundingMethod: bank ? "FIAT_LOCAL" : "STABLECOIN", ...(bank ? {} : { token: d.token }), prefer: "balanced",
    });
    const transfer = await createTransferFromQuote(invoice.organizationId, {
      quoteId: row.id, invoiceId: invoice.id, purposeCode: invoice.purposeCode ?? undefined,
      description: `Invoice ${invoice.number}`, isSandbox: invoice.organization.kybStatus !== "APPROVED",
    });
    const full = await db.transfer.findUniqueOrThrow({ where: { id: transfer.id }, include: { deposits: true } });
    return apiSuccess(publicPayView(full), 201);
  } catch (e) {
    if (e instanceof ServiceError) {
      // Do not leak internal rules to anonymous payers; give an actionable, generic message.
      if (e.code === "GUARDRAIL_VIOLATION") return apiError("NOT_AVAILABLE", "This invoice cannot be paid this way right now. Please contact the sender.", 409);
      if (e.code === "NO_ROUTE" || e.code === "UNSUPPORTED_CURRENCY") return apiError("NOT_AVAILABLE", "This payment method is not available for this invoice.", 422);
    }
    return handleServiceError(e);
  }
}
