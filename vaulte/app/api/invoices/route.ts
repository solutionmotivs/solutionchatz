// app/api/invoices/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyApiKey } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { z } from "zod";

const CreateInvoiceSchema = z.object({
  number: z.string().min(1).max(64),
  currency: z.string().length(3).toUpperCase(),
  issuer_entity_id: z.string().optional(),
  payer_entity_id: z.string().optional(),
  due_date: z.string().optional(),
  notes: z.string().max(1000).optional(),
  purpose_code: z.string().regex(/^P\d{4}$/, "Purpose code must look like P0802").optional(),
  line_items: z.array(z.object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    unit_price: z.number().int().positive(),
    tax_rate: z.number().min(0).max(100).default(0),
  })).min(1),
});

export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);

  let body: unknown;
  try { body = await req.json(); } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const parsed = CreateInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    const e = parsed.error.errors[0];
    return apiError("VALIDATION_ERROR", e.message, 400, e.path.join("."));
  }

  const data = parsed.data;

  // Check unique invoice number per org
  const existing = await db.invoice.findUnique({
    where: { organizationId_number: { organizationId: auth.organizationId, number: data.number } },
  });
  if (existing) return apiError("DUPLICATE_INVOICE", `Invoice number ${data.number} already exists`, 409);

  // Calculate totals
  const lineItems = data.line_items.map(li => {
    const lineTotal = Math.round(li.quantity * li.unit_price);
    const taxAmount = Math.round(lineTotal * (li.tax_rate / 100));
    return { ...li, total: lineTotal + taxAmount };
  });

  const subtotal = lineItems.reduce((s, li) => s + Math.round(li.quantity * li.unit_price), 0);
  const taxAmount = lineItems.reduce((s, li) => s + Math.round(li.quantity * li.unit_price * li.tax_rate / 100), 0);
  const totalAmount = subtotal + taxAmount;

  const invoice = await db.invoice.create({
    data: {
      number: data.number,
      currency: data.currency,
      status: "DRAFT",
      subtotal: BigInt(subtotal),
      taxAmount: BigInt(taxAmount),
      totalAmount: BigInt(totalAmount),
      dueDate: data.due_date ? new Date(data.due_date) : null,
      notes: data.notes ?? null,
      purposeCode: data.purpose_code ?? null,
      issuerEntityId: data.issuer_entity_id ?? null,
      payerEntityId: data.payer_entity_id ?? null,
      organizationId: auth.organizationId,
      lineItems: {
        create: lineItems.map(li => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: BigInt(li.unit_price),
          taxRate: li.tax_rate,
          total: BigInt(li.total),
        })),
      },
    },
    include: { lineItems: true },
  });

  return apiSuccess({
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    currency: invoice.currency,
    subtotal: Number(invoice.subtotal),
    tax_amount: Number(invoice.taxAmount),
    total_amount: Number(invoice.totalAmount),
    due_date: invoice.dueDate?.toISOString() ?? null,
    line_items: invoice.lineItems.map(li => ({
      description: li.description,
      quantity: li.quantity,
      unit_price: Number(li.unitPrice),
      tax_rate: li.taxRate,
      total: Number(li.total),
    })),
    created_at: invoice.createdAt.toISOString(),
  }, 201);
}

export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const perPage = Math.min(100, parseInt(searchParams.get("per_page") ?? "20"));

  const where = {
    organizationId: auth.organizationId,
    ...(status ? { status: status as import("@prisma/client").InvoiceStatus } : {}),
  };

  const [invoices, total] = await Promise.all([
    db.invoice.findMany({ where, orderBy: { createdAt: "desc" }, take: perPage, skip: (page - 1) * perPage }),
    db.invoice.count({ where }),
  ]);

  return apiSuccess({
    data: invoices.map(inv => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      currency: inv.currency,
      total_amount: Number(inv.totalAmount),
      due_date: inv.dueDate?.toISOString() ?? null,
      paid_at: inv.paidAt?.toISOString() ?? null,
      created_at: inv.createdAt.toISOString(),
    })),
    has_more: total > page * perPage,
    total,
    page,
    per_page: perPage,
  });
}
