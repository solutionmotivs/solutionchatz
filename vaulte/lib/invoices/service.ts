// Invoice, proforma, payment-link and hosted-checkout creation: one code path for dashboard, API and checkout.
import type { Invoice, InvoiceKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { emitWebhookEvent } from "@/lib/webhooks/dispatch";
import { computeLines, formatNumber, PREFIX, safeReturnUrl, type LineInput } from "./calc";

export class InvoiceError extends Error {
  constructor(public code: string, message: string, public status = 400, public param?: string) { super(message); }
}

export interface CreateInput {
  kind?: InvoiceKind;
  number?: string;
  currency: string;
  issuerEntityId?: string;
  payerEntityId?: string;
  payerName?: string; payerEmail?: string; payerAddress?: string; payerTaxId?: string;
  dueDate?: string; notes?: string; purposeCode?: string; reference?: string;
  lines: LineInput[];
  source?: "DASHBOARD" | "API" | "PAYMENT_LINK" | "CHECKOUT";
  prefix?: string;
  /** Links and checkout sessions are useless without a payee: refuse instead of creating something nobody can pay. */
  requireIssuer?: boolean;
  successUrl?: string; cancelUrl?: string;
}

/** The organisation's payee entity: the one named, or the only one it has. Payers cannot pay an invoice without it. */
export async function resolveIssuer(organizationId: string, issuerEntityId?: string): Promise<string | null> {
  if (issuerEntityId) {
    const e = await db.entity.findFirst({ where: { id: issuerEntityId, organizationId }, select: { id: true } });
    if (!e) throw new InvoiceError("NOT_FOUND", "Issuer entity not found", 404, "issuer_entity_id");
    return e.id;
  }
  const all = await db.entity.findMany({ where: { organizationId }, select: { id: true }, take: 2 });
  return all.length === 1 ? all[0].id : null;
}

async function nextNumber(organizationId: string, prefix: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const start = `${prefix}-${year}-`;
  const last = await db.invoice.findFirst({ where: { organizationId, number: { startsWith: start } }, orderBy: { number: "desc" }, select: { number: true } });
  const seq = last ? Number(last.number.slice(start.length)) + 1 : 1;
  return formatNumber(prefix, year, Number.isFinite(seq) ? seq : 1);
}

export async function createInvoice(organizationId: string, input: CreateInput): Promise<Invoice & { lineItems: { description: string; quantity: number; unitPrice: bigint; taxRate: number; total: bigint }[] }> {
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new InvoiceError("VALIDATION_ERROR", "currency must be a 3-letter code", 400, "currency");
  if (!input.lines.length) throw new InvoiceError("VALIDATION_ERROR", "Add at least one line item", 400, "line_items");
  const kind = input.kind ?? "INVOICE";
  const calc = computeLines(input.lines);
  if (calc.total <= 0 || calc.total > 1e12) throw new InvoiceError("VALIDATION_ERROR", "Invoice total must be positive", 400, "line_items");
  const successUrl = safeReturnUrl(input.successUrl), cancelUrl = safeReturnUrl(input.cancelUrl);
  if (input.successUrl && !successUrl) throw new InvoiceError("VALIDATION_ERROR", "success_url must be an https URL", 400, "success_url");
  if (input.cancelUrl && !cancelUrl) throw new InvoiceError("VALIDATION_ERROR", "cancel_url must be an https URL", 400, "cancel_url");
  const issuerEntityId = await resolveIssuer(organizationId, input.issuerEntityId);
  if (input.requireIssuer && !issuerEntityId) throw new InvoiceError("PAYEE_REQUIRED", "Say who gets paid: pass issuer_entity_id (your organisation has more than one entity, or none yet)", 400, "issuer_entity_id");
  const prefix = input.prefix ?? (kind === "PROFORMA" ? PREFIX.PROFORMA : PREFIX.INVOICE);

  for (let attempt = 0; attempt < 4; attempt++) {
    const number = input.number ?? await nextNumber(organizationId, prefix);
    if (input.number && await db.invoice.findUnique({ where: { organizationId_number: { organizationId, number } }, select: { id: true } })) {
      throw new InvoiceError("DUPLICATE_INVOICE", `Number ${number} already exists`, 409, "number");
    }
    try {
      const inv = await db.invoice.create({
        data: {
          number, kind, currency: input.currency, status: "DRAFT",
          subtotal: BigInt(calc.subtotal), taxAmount: BigInt(calc.tax), totalAmount: BigInt(calc.total),
          dueDate: input.dueDate ? new Date(input.dueDate) : null, notes: input.notes ?? null, purposeCode: input.purposeCode ?? null,
          issuerEntityId, payerEntityId: input.payerEntityId ?? null,
          recipientName: input.payerName ?? null, recipientEmail: input.payerEmail ?? null, payerAddress: input.payerAddress ?? null, payerTaxId: input.payerTaxId ?? null,
          reference: input.reference ?? null, successUrl, cancelUrl, source: input.source ?? "DASHBOARD", organizationId,
          lineItems: { create: calc.lines.map(l => ({ description: l.description, quantity: l.quantity, unitPrice: BigInt(l.unit_price), taxRate: l.tax_rate, total: BigInt(l.total) })) },
        },
        include: { lineItems: true },
      });
      await emitWebhookEvent({ organizationId, event: "invoice.created", data: { invoice_id: inv.id, number: inv.number, kind: inv.kind, reference: inv.reference } });
      return inv;
    } catch (e) {
      // Two creations raced for the same auto number: take the next one.
      if (!input.number && (e as { code?: string }).code === "P2002") continue;
      throw e;
    }
  }
  throw new InvoiceError("CONFLICT", "Could not allocate an invoice number; try again", 409);
}

/** Proforma -> numbered tax invoice. The proforma is closed so it cannot be paid twice. */
export async function convertProforma(organizationId: string, id: string) {
  const pf = await db.invoice.findFirst({ where: { id, organizationId }, include: { lineItems: true } });
  if (!pf) throw new InvoiceError("NOT_FOUND", "Invoice not found", 404);
  if (pf.kind !== "PROFORMA") throw new InvoiceError("NOT_PROFORMA", "Only a proforma can be converted", 409);
  if (pf.status === "CANCELLED" || pf.status === "PAID") throw new InvoiceError("NOT_CONVERTIBLE", `A ${pf.status.toLowerCase()} proforma cannot be converted`, 409);
  const existing = await db.invoice.findFirst({ where: { organizationId, proformaOfId: pf.id }, select: { id: true } });
  if (existing) throw new InvoiceError("ALREADY_CONVERTED", "This proforma was already converted", 409);
  const inv = await createInvoice(organizationId, {
    kind: "INVOICE", currency: pf.currency, issuerEntityId: pf.issuerEntityId ?? undefined, payerEntityId: pf.payerEntityId ?? undefined,
    payerName: pf.recipientName ?? undefined, payerEmail: pf.recipientEmail ?? undefined, payerAddress: pf.payerAddress ?? undefined, payerTaxId: pf.payerTaxId ?? undefined,
    dueDate: pf.dueDate?.toISOString(), notes: pf.notes ?? undefined, purposeCode: pf.purposeCode ?? undefined, reference: pf.reference ?? undefined,
    lines: pf.lineItems.map(l => ({ description: l.description, quantity: l.quantity, unit_price: Number(l.unitPrice), tax_rate: l.taxRate })),
    source: (pf.source as CreateInput["source"]) ?? "DASHBOARD",
  });
  const updated = await db.invoice.update({ where: { id: inv.id }, data: { proformaOfId: pf.id, status: pf.status === "SENT" ? "SENT" : "DRAFT" }, include: { lineItems: true } });
  await db.invoice.update({ where: { id: pf.id }, data: { status: "CANCELLED", notes: `${pf.notes ? pf.notes + "\n" : ""}Converted to invoice ${inv.number}.` } });
  return updated;
}

export function invoiceUrls(token: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return { pay_url: `${base}/pay/${token}`, pdf_url: `${base}/api/pay/${token}/pdf` };
}

export function presentInvoice(inv: Invoice & { lineItems?: { description: string; quantity: number; unitPrice: bigint; taxRate: number; total: bigint }[] }) {
  return {
    id: inv.id, number: inv.number, kind: inv.kind, status: inv.status, currency: inv.currency,
    subtotal: Number(inv.subtotal), tax_amount: Number(inv.taxAmount), total_amount: Number(inv.totalAmount),
    due_date: inv.dueDate?.toISOString() ?? null, paid_at: inv.paidAt?.toISOString() ?? null, created_at: inv.createdAt.toISOString(),
    payer_name: inv.recipientName, payer_email: inv.recipientEmail, reference: inv.reference, notes: inv.notes, purpose_code: inv.purposeCode,
    proforma_of: inv.proformaOfId, source: inv.source, ...invoiceUrls(inv.publicToken),
    ...(inv.lineItems ? { line_items: inv.lineItems.map(l => ({ description: l.description, quantity: l.quantity, unit_price: Number(l.unitPrice), tax_rate: l.taxRate, total: Number(l.total) })) } : {}),
  };
}

export type { Prisma };
