// POST /api/privacy-requests — public data-subject request (access, correction, erasure, ...). Rate limited, honeypot. Identity is confirmed by staff before any data is released or erased.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { clientIp, rateLimit } from "@/lib/security/ratelimit";
import { sendEmail } from "@/lib/email/sender";
import { REQUEST_REGIONS, REQUEST_TYPES, dueDate, newReference } from "@/lib/privacy-requests";

const Schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  region: z.enum(REQUEST_REGIONS),
  type: z.enum(REQUEST_TYPES),
  details: z.string().trim().max(2000).optional(),
  website: z.string().max(0).optional(), // honeypot
});

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function POST(req: NextRequest) {
  if (!rateLimit(`dsr:${clientIp(req)}`, 6, 3600_000)) return apiError("RATE_LIMITED", "Too many requests. Try again later or email us.", 429);
  let body: unknown; try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Request body must be valid JSON", 400); }
  const p = Schema.safeParse(body);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join("."));
  const d = p.data;
  const user = await db.user.findUnique({ where: { email: d.email }, select: { id: true } });
  const reference = newReference();
  const row = await db.privacyRequest.create({ data: { reference, email: d.email, name: d.name, region: d.region, type: d.type, details: d.details ?? null, userId: user?.id ?? null, dueAt: dueDate(d.region) } });
  const text = `Hello ${d.name},\n\nWe received your data request (${d.type.toLowerCase().replace(/_/g, " ")}). Your reference is ${reference}.\n\nWhat happens next: we will email you at this address to confirm it is really you before we release or change anything. We answer within ${Math.round((row.dueAt.getTime() - row.createdAt.getTime()) / 86_400_000)} days. If you did not make this request, ignore this email and no data will be released.\n\nVaulte`;
  await sendEmail({ to: d.email, template: { subject: `Your Vaulte data request ${reference}`, text, html: `<p style="font-family:sans-serif;font-size:14px;line-height:1.5">${esc(text).replace(/\n/g, "<br>")}</p>` } }).catch(() => {});
  const ops = process.env.PRIVACY_EMAIL || process.env.SUPPORT_EMAIL || process.env.OPS_EMAIL;
  if (ops) {
    const t = `New data request ${reference}: ${d.type} from ${d.name} <${d.email}> (${d.region}). Due ${row.dueAt.toISOString().slice(0, 10)}.\nAccount holder: ${user ? "yes" : "no"}\n${d.details ?? ""}`;
    await sendEmail({ to: ops, template: { subject: `Data request ${reference} (${d.type})`, text: t, html: `<p style="font-family:sans-serif;font-size:13px">${esc(t).replace(/\n/g, "<br>")}</p>` } }).catch(() => {});
  }
  return apiSuccess({ reference, due_at: row.dueAt.toISOString(), message: "We have your request. Check your email for the reference." }, 201);
}
