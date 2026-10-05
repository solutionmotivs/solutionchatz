// app/api/invoices/[id]/send/route.ts
// THE VIRAL LOOP — sends invoice email to recipient with "Pay Now" button
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser, verifyApiKey } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { sendEmail } from "@/lib/email/sender";
import { invoiceEmail } from "@/lib/email/templates";
import { z } from "zod";

const SendSchema = z.object({
  recipientEmail: z.string().email(),
  recipientName: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser();
  const apiAuth = await verifyApiKey(req.headers.get("authorization"));
  const orgId = user?.organizationId ?? apiAuth?.organizationId;
  if (!orgId) return apiError("UNAUTHORIZED", "Not authenticated", 401);

  const body = await req.json();
  const parsed = SendSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  }

  const invoice = await db.invoice.findFirst({
    where: { id: params.id, organizationId: orgId },
    include: { lineItems: true, organization: { select: { name: true, poweredByEnabled: true } } },
  });

  if (!invoice) return apiError("NOT_FOUND", "Invoice not found", 404);
  if (invoice.status === "PAID") return apiError("ALREADY_PAID", "Invoice is already paid", 409);

  // Abuse control: organizations without approved KYB can only email a few invoices per day.
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { kybStatus: true } });
  if (org?.kybStatus !== "APPROVED") {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sentToday = await db.invoice.count({ where: { organizationId: orgId, emailSentAt: { gte: since } } });
    if (sentToday >= 3) {
      return apiError("RATE_LIMITED", "Complete KYB to send more than 3 invoice emails per day", 429);
    }
  }

  const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.vaulte.io";
  const payUrl = `${BASE_URL}/pay/${invoice.publicToken}`;

  // Update invoice with recipient info
  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      recipientEmail: parsed.data.recipientEmail,
      recipientName: parsed.data.recipientName,
      status: "SENT",
      emailSentAt: new Date(),
    },
  });

  // Send the email — THIS IS THE VIRAL LOOP
  const template = invoiceEmail({
    recipientName: parsed.data.recipientName,
    senderName: invoice.organization.name,
    invoiceNumber: invoice.number,
    amount: Number(invoice.totalAmount),
    currency: invoice.currency,
    dueDate: invoice.dueDate
      ? new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(invoice.dueDate)
      : null,
    payUrl,
    lineItems: invoice.lineItems.map(li => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: Number(li.unitPrice),
      total: Number(li.total),
    })),
    poweredBy: invoice.organization.poweredByEnabled,
  });

  const result = await sendEmail({
    to: parsed.data.recipientEmail,
    template,
    organizationId: orgId,
  });

  await db.auditLog.create({
    data: {
      action: "invoice.sent",
      resourceType: "Invoice",
      resourceId: invoice.id,
      metadata: { recipientEmail: parsed.data.recipientEmail, payUrl },
      organizationId: orgId,
      userId: user?.id ?? null,
    },
  });

  return apiSuccess({
    sent: result.success,
    recipient_email: parsed.data.recipientEmail,
    pay_url: payUrl,
    invoice_status: "SENT",
  });
}
