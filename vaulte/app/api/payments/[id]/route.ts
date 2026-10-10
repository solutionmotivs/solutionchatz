// app/api/payments/[id]/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyApiKey } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);

  const payment = await db.payment.findFirst({
    where: { id: params.id, organizationId: auth.organizationId },
    include: {
      senderEntity: { select: { legalName: true, country: true } },
      recipientEntity: { select: { legalName: true, country: true } },
      invoice: { select: { number: true, status: true } },
    },
  });

  if (!payment) return apiError("NOT_FOUND", "Payment not found", 404);

  return apiSuccess({
    id: payment.id,
    status: payment.status,
    amount: Number(payment.amount),
    currency: payment.currency,
    rail_selected: payment.railSelected,
    rail_requested: payment.rail,
    estimated_arrival: payment.estimatedArrival?.toISOString() ?? null,
    compliance_cleared: payment.complianceCleared,
    fx_rate: payment.fxRate,
    fee: Number(payment.feeAmount ?? 0),
    network_fee: Number(payment.networkFee ?? 0),
    external_ref: payment.externalRef,
    sender: {
      entity_name: payment.senderEntity.legalName,
      country: payment.senderEntity.country,
    },
    recipient: {
      entity_name: payment.recipientEntity.legalName,
      country: payment.recipientEntity.country,
    },
    invoice: payment.invoice
      ? { number: payment.invoice.number, status: payment.invoice.status }
      : null,
    created_at: payment.createdAt.toISOString(),
    processed_at: payment.processedAt?.toISOString() ?? null,
    settled_at: payment.settledAt?.toISOString() ?? null,
    failed_at: payment.failedAt?.toISOString() ?? null,
    cancelled_at: payment.cancelledAt?.toISOString() ?? null,
    metadata: payment.metadata,
    description: payment.description,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);

  const payment = await db.payment.findFirst({
    where: { id: params.id, organizationId: auth.organizationId },
  });

  if (!payment) return apiError("NOT_FOUND", "Payment not found", 404);

  // Can only cancel DRAFT, PENDING_COMPLIANCE, COMPLIANCE_CLEARED payments
  const cancellableStatuses = ["DRAFT", "PENDING_COMPLIANCE", "COMPLIANCE_CLEARED"];
  if (!cancellableStatuses.includes(payment.status)) {
    return apiError(
      "CANNOT_CANCEL",
      `Payment in status ${payment.status} cannot be cancelled. Use recall for settled payments.`,
      409
    );
  }

  const cancelled = await db.payment.update({
    where: { id: params.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
    },
  });

  await db.auditLog.create({
    data: {
      action: "payment.cancelled",
      resourceType: "Payment",
      resourceId: payment.id,
      organizationId: auth.organizationId,
    },
  });

  return apiSuccess({
    id: cancelled.id,
    status: cancelled.status,
    cancelled_at: cancelled.cancelledAt?.toISOString(),
    refund_status: "processing",
    refund_eta: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  });
}
