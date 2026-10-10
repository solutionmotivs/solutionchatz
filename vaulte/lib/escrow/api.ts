import type { NextRequest } from "next/server";
import type { ZodTypeAny, z } from "zod";
import { apiError } from "@/lib/utils";
import { clientIp, rateLimit } from "@/lib/security/ratelimit";
import { EscrowError } from "./service";
import { EscrowNotConfigured } from "./agent";

export async function body<S extends ZodTypeAny>(req: Request, schema: S): Promise<{ data: z.infer<S>; response?: undefined } | { data?: undefined; response: Response }> {
  let raw: unknown;
  try { raw = await req.json(); } catch { return { response: apiError("INVALID_JSON", "Body must be JSON", 400) }; }
  const p = schema.safeParse(raw);
  if (!p.success) return { response: apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join(".")) };
  return { data: p.data };
}

export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof EscrowError) return apiError(e.code, e.message, e.status, e.param);
    if (e instanceof EscrowNotConfigured) return apiError("ESCROW_NOT_AVAILABLE", e.message, 409);
    throw e;
  }
}

/** Public (token-link) endpoints: per-IP throttle so links cannot be hammered. */
export const publicLimited = (req: NextRequest, bucket: string, limit = 60) => !rateLimit(`escrow:${bucket}:${clientIp(req)}`, limit, 60_000);
