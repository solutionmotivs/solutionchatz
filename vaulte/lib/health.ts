// Readiness checks. Details are deliberately coarse: this endpoint is public, so it never reveals versions, hosts or secrets.
import { db } from "@/lib/db";
import { guardsInstalled } from "@/lib/ledger/guards";

export interface Check { name: string; ok: boolean; detail?: string; critical: boolean }

export async function readiness(): Promise<{ ok: boolean; checks: Check[] }> {
  const prod = process.env.NODE_ENV === "production";
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, critical: boolean, detail?: string) => checks.push({ name, ok, critical, detail });

  try { await db.$queryRaw`SELECT 1`; add("database", true, true); } catch { add("database", false, true, "unreachable"); }

  try { add("ledger_guards", await guardsInstalled(), true, "append-only/balance triggers"); } catch { add("ledger_guards", false, true, "unknown"); }

  try {
    const lists = await db.sanctionsList.findMany({ where: { status: "OK" }, select: { code: true, fetchedAt: true } });
    const oldest = lists.reduce((m, l) => Math.min(m, l.fetchedAt.getTime()), Date.now());
    const fresh = lists.length >= 3 && Date.now() - oldest < 48 * 3600_000;
    add("sanctions_lists", prod ? fresh : true, prod, lists.length < 3 ? "lists not loaded" : fresh ? "fresh" : "older than 48h");
  } catch { add("sanctions_lists", false, prod, "unknown"); }

  add("email_provider", !prod || !!process.env.RESEND_API_KEY, prod, "RESEND_API_KEY");
  add("document_storage", !prod || !!process.env.S3_BUCKET, prod, "S3_BUCKET");
  add("secrets", !prod || ((process.env.JWT_SECRET?.length ?? 0) >= 32 && (process.env.OTP_PEPPER?.length ?? 0) >= 32 && (process.env.ENCRYPTION_KEY?.length ?? 0) >= 32 && (process.env.CRON_SECRET?.length ?? 0) >= 24), prod, "JWT_SECRET, OTP_PEPPER, ENCRYPTION_KEY, CRON_SECRET");
  add("fx_rates", !prod || !!process.env.OPENEXCHANGERATES_APP_ID, prod, "OPENEXCHANGERATES_APP_ID");
  add("dev_otp_disabled", !(prod && process.env.AUTH_EXPOSE_DEV_OTP === "true"), prod, "AUTH_EXPOSE_DEV_OTP");
  return { ok: checks.every(c => c.ok || !c.critical), checks };
}
