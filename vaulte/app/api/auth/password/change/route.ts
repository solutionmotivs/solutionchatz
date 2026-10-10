import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";
import { hashPassword, validatePassword, verifyPassword } from "@/lib/security/password";
import { hit } from "@/lib/security/ratelimit-db";
import { revokeAllSessions } from "@/lib/session";
import { sendEmail } from "@/lib/email/sender";
import { securityNoticeEmail } from "@/lib/email/templates";

const Schema = z.object({ current_password: z.string().min(1).max(128), new_password: z.string().min(10).max(128) });

export async function POST(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  const lim = await hit(`pwchange:${g.user.id}`, 5, 900);
  if (!lim.allowed) return apiError("RATE_LIMITED", "Too many attempts. Try again later.", 429);
  const user = await db.user.findUniqueOrThrow({ where: { id: g.user.id } });
  if (!(await verifyPassword(parsed.data.current_password, user.passwordHash))) return apiError("INVALID_CREDENTIALS", "Current password is incorrect", 401);
  const pwErr = validatePassword(parsed.data.new_password, { email: user.email, name: user.name });
  if (pwErr) return apiError("WEAK_PASSWORD", pwErr, 400, "new_password");
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.new_password), passwordChangedAt: new Date() } });
  await revokeAllSessions(user.id, g.user.sessionId); // keep this device signed in
  await db.auditLog.create({ data: { action: "password.changed", resourceType: "User", resourceId: user.id, organizationId: user.organizationId, userId: user.id } });
  sendEmail({ to: user.email, template: securityNoticeEmail({ name: user.name, event: "Your password was changed", detail: "Other devices were signed out." }) }).catch(() => {});
  return apiSuccess({ status: "ok" });
}
