import { z } from "zod";

const Line = z.object({
  description: z.string().min(1).max(300),
  quantity: z.number().positive().max(1e9),
  unit_price: z.number().int().min(0).max(1e12),
  tax_rate: z.number().min(0).max(100).default(0),
});

export const CreateInvoiceSchema = z.object({
  kind: z.enum(["INVOICE", "PROFORMA"]).default("INVOICE"),
  number: z.string().min(1).max(64).optional(),
  currency: z.string().length(3).toUpperCase(),
  issuer_entity_id: z.string().optional(),
  payer_entity_id: z.string().optional(),
  payer_name: z.string().max(200).optional(),
  payer_email: z.string().email().optional(),
  payer_address: z.string().max(500).optional(),
  payer_tax_id: z.string().max(50).optional(),
  reference: z.string().max(100).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "due_date must be YYYY-MM-DD").optional(),
  notes: z.string().max(1000).optional(),
  purpose_code: z.string().regex(/^P\d{4}$/, "Purpose code must look like P0802").optional(),
  line_items: z.array(Line).min(1).max(100),
});

