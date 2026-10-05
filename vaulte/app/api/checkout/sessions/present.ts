import type { Invoice } from "@prisma/client";
import { invoiceUrls } from "@/lib/invoices/service";

export function presentSession(inv: Invoice) {
  const status = inv.status === "PAID" ? "complete" : inv.status === "CANCELLED" ? "expired" : "open";
  return {
    id: inv.id, object: "checkout.session", status, url: invoiceUrls(inv.publicToken).pay_url, invoice_number: inv.number,
    amount_total: Number(inv.totalAmount), currency: inv.currency, client_reference_id: inv.reference, customer_email: inv.recipientEmail,
    success_url: inv.successUrl, cancel_url: inv.cancelUrl, paid_at: inv.paidAt?.toISOString() ?? null, created_at: inv.createdAt.toISOString(),
  };
}
