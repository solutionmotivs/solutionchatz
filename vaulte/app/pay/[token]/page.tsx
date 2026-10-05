// app/pay/[token]/page.tsx
// Public payment page — no login required for recipient
// This is the viral loop landing page
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import PublicPayPage from "@/components/invoice/PublicPayPage";

export async function generateMetadata({ params }: { params: { token: string } }) {
  const invoice = await db.invoice.findUnique({
    where: { publicToken: params.token },
    include: { organization: { select: { name: true } } },
  });

  if (!invoice) return { title: "Invoice Not Found" };

  const amount = new Intl.NumberFormat("en-US", {
    style: "currency", currency: invoice.currency,
  }).format(Number(invoice.totalAmount) / 100);

  return {
    title: `${invoice.kind === "PROFORMA" ? "Proforma" : "Invoice"} ${invoice.number} — ${amount} from ${invoice.organization.name}`,
    description: `Pay invoice ${invoice.number} from ${invoice.organization.name} securely via Vaulte.`,
  };
}

export default async function PublicPayPageServer({ params }: { params: { token: string } }) {
  const invoice = await db.invoice.findUnique({
    where: { publicToken: params.token },
    include: {
      lineItems: true,
      organization: {
        select: { name: true, logoUrl: true, poweredByEnabled: true },
      },
    },
  });

  if (!invoice) notFound();

  // Track view
  await db.invoice.update({
    where: { id: invoice.id },
    data: { viewCount: { increment: 1 } },
  }).catch(() => {});

  return (
    <PublicPayPage
      payToken={params.token}
      invoice={{
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        currency: invoice.currency,
        totalAmount: Number(invoice.totalAmount),
        subtotal: Number(invoice.subtotal),
        taxAmount: Number(invoice.taxAmount),
        dueDate: invoice.dueDate?.toISOString() ?? null,
        notes: invoice.notes,
        recipientName: invoice.recipientName,
        organizationName: invoice.organization.name,
        poweredBy: invoice.organization.poweredByEnabled,
        kind: invoice.kind, successUrl: invoice.status === "PAID" ? invoice.successUrl : null, cancelUrl: invoice.cancelUrl, reference: invoice.reference,
        lineItems: invoice.lineItems.map(li => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: Number(li.unitPrice),
          taxRate: li.taxRate,
          total: Number(li.total),
        })),
      }}
    />
  );
}
