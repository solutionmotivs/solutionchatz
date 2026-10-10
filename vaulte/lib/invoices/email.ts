// Emailing an invoice / payment request with its pay link.
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/sender";
import { invoiceEmail } from "@/lib/email/templates";
import { InvoiceError, invoiceUrls } from "./service";

/** Sends the pay link by email and marks the invoice SENT. Unverified businesses are capped at 3 emails per day (abuse control). */
export async function emailInvoice(organizationId: string, invoiceId: string, to: { email: string; name: string }, userId?: string) {
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, organizationId }, include: { lineItems: true, organization: { select: { name: true, poweredByEnabled: true, kybStatus: true } } } });
  if (!invoice) throw new InvoiceError("NOT_FOUND", "Invoice not found", 404);
  if (invoice.status === "PAID") throw new InvoiceError("ALREADY_PAID", "Invoice is already paid", 409);
  if (invoice.status === "CANCELLED") throw new InvoiceError("CANCELLED", "This invoice was cancelled", 409);
  if (invoice.organization.kybStatus !== "APPROVED") {
    const sentToday = await db.invoice.count({ where: { organizationId, emailSentAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
    if (sentToday >= 3) throw new InvoiceError("RATE_LIMITED", "Complete KYB to send more than 3 invoice emails per day", 429);
  }
  const { pay_url } = invoiceUrls(invoice.publicToken);
  await db.invoice.update({ where: { id: invoice.id }, data: { recipientEmail: to.email, recipientName: to.name, status: "SENT", emailSentAt: new Date() } });
  const template = invoiceEmail({
    recipientName: to.name, senderName: invoice.organization.name, invoiceNumber: invoice.number,
    amount: Number(invoice.totalAmount), currency: invoice.currency,
    dueDate: invoice.dueDate ? new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(invoice.dueDate) : null,
    payUrl: pay_url, lineItems: invoice.lineItems.map(li => ({ description: li.description, quantity: li.quantity, unitPrice: Number(li.unitPrice), total: Number(li.total) })),
    poweredBy: invoice.organization.poweredByEnabled,
  });
  const result = await sendEmail({ to: to.email, template, organizationId });
  await db.auditLog.create({ data: { action: "invoice.sent", resourceType: "Invoice", resourceId: invoice.id, metadata: { recipientEmail: to.email, payUrl: pay_url }, organizationId, userId: userId ?? null } });
  return { sent: result.success, pay_url };
}
