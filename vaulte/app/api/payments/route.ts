// app/api/payments/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyApiKey } from "@/lib/auth";
import { selectRail, calculateFee } from "@/lib/rails/router";
import { screenEntity, assessTransactionRisk } from "@/lib/compliance/aml";
import { convertToUsd } from "@/lib/fx";
import { dispatchPayment } from "@/lib/psp/dispatcher";
import { sendEmail } from "@/lib/email/sender";
import { paymentSettledEmail, paymentFailedEmail } from "@/lib/email/templates";
import { apiError, apiSuccess, railToLabel } from "@/lib/utils";
import { z } from "zod";

const CreatePaymentSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3).toUpperCase(),
  rail: z.enum([
    "SWIFT_GPI","SEPA_INSTANT","SEPA_CREDIT","ACH_SAME_DAY",
    "ACH_STANDARD","FEDNOW","UPI","RTGS","NEFT","AUTO"
  ]).default("AUTO"),
  sender: z.object({
    entity_id: z.string(),
    account_id: z.string().optional(),
  }),
  recipient: z.object({
    entity_id: z.string(),
    account_id: z.string().optional(),
  }),
  invoice_id: z.string().optional(),
  idempotency_key: z.string().max(255).optional(),
  description: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  // Auth
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);
  if (!auth.scopes.includes("payments:write")) {
    return apiError("FORBIDDEN", "API key missing payments:write scope", 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const parsed = CreatePaymentSchema.safeParse(body);
  if (!parsed.success) {
    const e = parsed.error.errors[0];
    return apiError("VALIDATION_ERROR", e.message, 400, e.path.join("."));
  }

  const data = parsed.data;

  // Idempotency check
  if (data.idempotency_key) {
    const existing = await db.payment.findUnique({ where: { idempotencyKey: data.idempotency_key } });
    if (existing) return apiSuccess(serializePayment(existing));
  }

  // Fetch org
  const org = await db.organization.findUnique({
    where: { id: auth.organizationId },
    select: {
      kybStatus: true, riskTier: true, planId: true,
      sandboxEnabled: true, dailyLimitUsd: true, monthlyLimitUsd: true,
    },
  });
  if (!org) return apiError("NOT_FOUND", "Organization not found", 404);

  // KYB gate — allow sandbox even without KYB
  const isSandbox = org.kybStatus !== "APPROVED";
  if (!isSandbox && org.riskTier === "BLOCKED") {
    return apiError("ACCOUNT_BLOCKED", "Account is blocked. Contact support.", 403);
  }

  // Fetch entities
  const [sender, recipient] = await Promise.all([
    db.entity.findFirst({ where: { id: data.sender.entity_id, organizationId: auth.organizationId } }),
    db.entity.findFirst({ where: { id: data.recipient.entity_id, organizationId: auth.organizationId } }),
  ]);
  if (!sender) return apiError("NOT_FOUND", "Sender entity not found", 404, "sender.entity_id");
  if (!recipient) return apiError("NOT_FOUND", "Recipient entity not found", 404, "recipient.entity_id");

  // AML screening (skip for sandbox)
  let complianceCleared = true;
  if (!isSandbox) {
    const [senderScreen, recipientScreen] = await Promise.all([
      screenEntity(sender.legalName, sender.country),
      screenEntity(recipient.legalName, recipient.country),
    ]);
    if (!senderScreen.cleared || !recipientScreen.cleared) {
      return apiError("SANCTIONS_HIT", "Transaction blocked: counterparty matched sanctions screening", 403);
    }
    const amountUsd = await convertToUsd(BigInt(data.amount), data.currency);
    const risk = assessTransactionRisk(amountUsd, sender.country, recipient.country, "technology");
    complianceCleared = risk.autoApprove;
  }

  // Rail selection
  const amountUsd = await convertToUsd(BigInt(data.amount), data.currency);
  const { rail, estimatedArrival, networkFeeCents } = selectRail(data.rail, {
    sourceCurrency: data.currency as import("@/types").Currency,
    destCurrency: data.currency as import("@/types").Currency,
    sourceCountry: sender.country,
    destCountry: recipient.country,
    amountUsd,
  });

  const feeAmount = calculateFee(BigInt(data.amount));

  // Create payment record
  const payment = await db.payment.create({
    data: {
      amount: BigInt(data.amount),
      amountUsd: BigInt(Math.round(amountUsd * 100)),
      currency: data.currency,
      fxRate: 1.0,
      feeAmount,
      networkFee: BigInt(networkFeeCents),
      rail: data.rail,
      railSelected: rail,
      status: isSandbox ? "PROCESSING" : complianceCleared ? "COMPLIANCE_CLEARED" : "PENDING_COMPLIANCE",
      isSandbox,
      invoiceId: data.invoice_id ?? null,
      idempotencyKey: data.idempotency_key ?? null,
      description: data.description ?? null,
      metadata: (data.metadata ?? undefined) as import("@prisma/client").Prisma.InputJsonValue | undefined,
      complianceCleared: isSandbox || complianceCleared,
      sanctionsHit: false,
      estimatedArrival,
      organizationId: auth.organizationId,
      senderEntityId: sender.id,
      recipientEntityId: recipient.id,
      bankAccountId: data.sender.account_id ?? null,
      processedAt: new Date(),
    },
  });

  // ── DISPATCH TO PSP ──────────────────────────────────────────────────────
  const recipientBank = data.recipient.account_id
    ? await db.bankAccount.findFirst({ where: { id: data.recipient.account_id, entityId: recipient.id } })
    : null;

  const dispatchResult = await dispatchPayment({
    paymentId: payment.id,
    rail,
    amount: BigInt(data.amount),
    currency: data.currency,
    isSandbox,
    recipientDetails: {
      name: recipient.legalName,
      accountNumber: recipientBank?.accountNumber ?? undefined,
      ifsc: recipientBank?.ifsc ?? undefined,
      upiId: recipientBank?.upiId ?? undefined,
      swiftBic: recipientBank?.swiftBic ?? undefined,
      iban: recipientBank?.iban ?? undefined,
    },
  });

  // Update payment with dispatch result
  const newStatus = dispatchResult.success ? "PROCESSING" : "FAILED";
  const settled = await db.payment.update({
    where: { id: payment.id },
    data: {
      status: newStatus,
      externalRef: dispatchResult.externalRef ?? null,
      ...(dispatchResult.success ? {} : { failedAt: new Date() }),
    },
  });

  // ── SIMULATE SANDBOX SETTLEMENT ──────────────────────────────────────────
  if (isSandbox && dispatchResult.success) {
    // Settle sandbox payments after short delay (non-blocking)
    setTimeout(async () => {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "SETTLED", settledAt: new Date() },
      }).catch(() => {});

      // Advance onboarding step if this was first test payment
      await db.organization.updateMany({
        where: { id: auth.organizationId, onboardingStep: "FIRST_PAYMENT" },
        data: { onboardingStep: "KYB_SUBMIT" },
      }).catch(() => {});
    }, 3000);
  }

  // ── EMAIL NOTIFICATIONS ──────────────────────────────────────────────────
  if (!isSandbox) {
    const orgUser = await db.user.findFirst({
      where: { organizationId: auth.organizationId, role: "OWNER" },
      select: { email: true, name: true },
    });

    if (orgUser) {
      if (dispatchResult.success) {
        sendEmail({
          to: orgUser.email,
          template: paymentSettledEmail({
            name: orgUser.name,
            amount: data.amount,
            currency: data.currency,
            rail: railToLabel(rail),
            recipientName: recipient.legalName,
            paymentId: payment.id,
            settledAt: new Date().toLocaleString(),
          }),
          organizationId: auth.organizationId,
        }).catch(() => {});
      } else {
        sendEmail({
          to: orgUser.email,
          template: paymentFailedEmail({
            name: orgUser.name,
            amount: data.amount,
            currency: data.currency,
            paymentId: payment.id,
            reason: dispatchResult.error ?? "Unknown error",
          }),
          organizationId: auth.organizationId,
        }).catch(() => {});
      }
    }
  }

  // Audit log
  await db.auditLog.create({
    data: {
      action: dispatchResult.success ? "payment.dispatched" : "payment.failed",
      resourceType: "Payment",
      resourceId: payment.id,
      metadata: { rail, isSandbox, psp: dispatchResult.psp },
      organizationId: auth.organizationId,
    },
  });

  return apiSuccess(serializePayment(settled), 201);
}

export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const perPage = Math.min(100, parseInt(searchParams.get("per_page") ?? "20"));
  const status = searchParams.get("status");
  const isSandbox = searchParams.get("sandbox");

  const where = {
    organizationId: auth.organizationId,
    ...(status ? { status: status as import("@prisma/client").PaymentStatus } : {}),
    ...(isSandbox !== null ? { isSandbox: isSandbox === "true" } : {}),
  };

  const [payments, total] = await Promise.all([
    db.payment.findMany({ where, orderBy: { createdAt: "desc" }, take: perPage, skip: (page - 1) * perPage }),
    db.payment.count({ where }),
  ]);

  return apiSuccess({
    data: payments.map(serializePayment),
    has_more: total > page * perPage,
    total, page, per_page: perPage,
  });
}

function serializePayment(p: {
  id: string; status: string; amount: bigint; currency: string;
  railSelected: string | null; estimatedArrival: Date | null;
  complianceCleared: boolean; fxRate: number | null;
  feeAmount: bigint | null; networkFee: bigint | null;
  externalRef: string | null; createdAt: Date;
  settledAt: Date | null; metadata: unknown; isSandbox: boolean;
}) {
  return {
    id: p.id,
    status: p.status,
    amount: Number(p.amount),
    currency: p.currency,
    rail_selected: p.railSelected,
    estimated_arrival: p.estimatedArrival?.toISOString() ?? null,
    compliance_cleared: p.complianceCleared,
    fx_rate: p.fxRate ?? 1.0,
    fee: Number(p.feeAmount ?? 0),
    network_fee: Number(p.networkFee ?? 0),
    external_ref: p.externalRef,
    is_sandbox: p.isSandbox,
    created_at: p.createdAt.toISOString(),
    settled_at: p.settledAt?.toISOString() ?? null,
    metadata: p.metadata,
  };
}
