// POST /api/leads — public "join the pilot" form. Rate limited, honeypot, explicit consent. Stores interest only; promises no live money.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { clientIp, rateLimit } from "@/lib/security/ratelimit";
import { sendEmail } from "@/lib/email/sender";

const Schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  company: z.string().trim().min(2).max(200),
  country: z.string().trim().toUpperCase().length(2),
  role: z.string().trim().max(100).optional(),
  corridor: z.string().trim().max(60).optional(),
  volume_band: z.enum(["<10k", "10k-100k", "100k-1m", ">1m"]).optional(),
  use_case: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(1000).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: "Please agree to be contacted" }) }),
  website: z.string().max(0).optional(), // honeypot: real people leave it empty
  source: z.string().trim().max(60).optional(),
});

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function POST(req: NextRequest) {
  if (!rateLimit(`lead:${clientIp(req)}`, 8, 3600_000)) return apiError("RATE_LIMITED", "Too many submissions. Try again later.", 429);
  let body: unknown; try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Request body must be valid JSON", 400); }
  const p = Schema.safeParse(body);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join("."));
  const d = p.data;
  const data = { name: d.name, company: d.company, country: d.country, role: d.role ?? null, corridor: d.corridor ?? null, volumeBand: d.volume_band ?? null, useCase: d.use_case ?? null, notes: d.notes ?? null, source: d.source ?? null, consentAt: new Date() };
  const existing = await db.pilotLead.findUnique({ where: { email: d.email } });
  // The same address again updates its own entry; the answer never reveals whether it was already registered.
  if (existing) await db.pilotLead.update({ where: { email: d.email }, data }); else await db.pilotLead.create({ data: { ...data, email: d.email } });
  if (!existing) {
    const text = `Thanks, ${d.name}. We received your interest in the Vaulte pilot.\n\nWhat this is: a test-mode pilot. You can try quotes, invoices, KYC/KYB and documents with simulated partners. No real money moves, and Vaulte does not hold funds. Live payments happen only through licensed partners, country by country, after legal review, and we will tell you plainly when a corridor is ready.\n\nWe will write to you at this address. If you did not ask for this, ignore this message.`;
    await sendEmail({ to: d.email, template: { subject: "Your Vaulte pilot request", text, html: `<p style="font-family:sans-serif;font-size:14px;line-height:1.5">${esc(text).replace(/\n/g, "<br>")}</p>` } }).catch(() => {});
    if (process.env.OPS_EMAIL) {
      const t = `New pilot lead: ${d.name} (${d.email}), ${d.company}, ${d.country}\nCorridor: ${d.corridor ?? "-"}  Volume: ${d.volume_band ?? "-"}\nUse case: ${d.use_case ?? "-"}`;
      await sendEmail({ to: process.env.OPS_EMAIL, template: { subject: `Pilot lead: ${d.company}`, text: t, html: `<p style="font-family:sans-serif;font-size:14px">${esc(t).replace(/\n/g, "<br>")}</p>` } }).catch(() => {});
    }
  }
  return apiSuccess({ received: true, message: "Thank you. We will be in touch." }, 201);
}
