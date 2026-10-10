// Atomic, shared (database-backed) fixed-window rate limiter. Safe across many server instances.
import { db } from "@/lib/db";

export interface LimitResult {
  allowed: boolean;
  count: number;
  remaining: number;
  retryAfterSec: number;
}

export async function hit(key: string, limit: number, windowSec: number): Promise<LimitResult> {
  const rows = await db.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${key}, 1, now() + (${windowSec} * interval '1 second'))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" < now() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" < now() THEN now() + (${windowSec} * interval '1 second') ELSE "RateLimit"."resetAt" END
    RETURNING "count", "resetAt"`;
  const { count, resetAt } = rows[0];
  const retry = Math.max(0, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000));
  return { allowed: count <= limit, count, remaining: Math.max(0, limit - count), retryAfterSec: retry };
}

/** Read-only check that does not count as a hit (e.g. to show lockout state). */
export async function peek(key: string): Promise<{ count: number; resetAt: Date } | null> {
  const r = await db.rateLimit.findUnique({ where: { key } });
  if (!r || r.resetAt.getTime() < Date.now()) return null;
  return { count: r.count, resetAt: r.resetAt };
}

export async function reset(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}
