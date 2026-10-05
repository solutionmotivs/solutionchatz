// lib/email/sender.ts
// Email sender — uses Resend API
// Falls back to console.log in dev if RESEND_API_KEY not set

import type { EmailTemplate } from "./templates";
import { log } from "@/lib/log";
import { db } from "@/lib/db";

const FROM = process.env.EMAIL_FROM ?? "Vaulte <noreply@vaulte.io>";

export async function sendEmail(opts: {
  to: string;
  template: EmailTemplate;
  organizationId?: string;
}): Promise<{ success: boolean; id?: string }> {
  const { to, template, organizationId } = opts;

  // Without a provider key: never pretend to deliver in production (OTP emails would be lost or leaked in logs).
  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "true") {
    log("error", "RESEND_API_KEY is not set: email not sent");
    await db.emailLog.create({
      data: { to, subject: template.subject, template: "unknown", status: "failed", organizationId: organizationId ?? null },
    }).catch(() => {});
    return { success: false };
  }

  // Dev fallback — log to console
  if (!process.env.RESEND_API_KEY) {
    console.log(`\n📧 EMAIL (dev mode — set RESEND_API_KEY to actually send)`);
    console.log(`   To:      ${to}`);
    console.log(`   Subject: ${template.subject}`);
    console.log(`   Preview: ${template.text.slice(0, 200)}...\n`);

    // Still log to DB
    await db.emailLog.create({
      data: { to, subject: template.subject, template: "dev", status: "dev_logged", organizationId: organizationId ?? null },
    }).catch(() => {});

    return { success: true, id: `dev_${Date.now()}` };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: template.subject,
        html: template.html,
        text: template.text,
      }),
    });

    const data = await res.json() as { id?: string; error?: { message: string } };

    if (!res.ok) {
      log("error", "email provider error", { error: data.error?.message });
      await db.emailLog.create({
        data: { to, subject: template.subject, template: "unknown", status: "failed", organizationId: organizationId ?? null },
      }).catch(() => {});
      return { success: false };
    }

    await db.emailLog.create({
      data: { to, subject: template.subject, template: "unknown", status: "sent", externalId: data.id, organizationId: organizationId ?? null },
    }).catch(() => {});

    return { success: true, id: data.id };
  } catch (err) {
    log("error", "email send error", { error: err });
    return { success: false };
  }
}
