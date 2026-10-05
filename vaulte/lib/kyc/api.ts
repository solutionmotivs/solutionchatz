// Shared helpers for verification routes.
import type { NextRequest } from "next/server";
import type { ZodTypeAny, z } from "zod";
import { requireUser } from "@/lib/auth-guards";
import { apiError } from "@/lib/utils";
import type { AuthUser } from "@/types";
import { KycError, loadCase, type FullCase } from "./service";

/** Customer roles that may change a verification. */
export const EDIT_ROLES = ["OWNER", "ADMIN"] as const;

export function handleError(e: unknown): Response {
  if (e instanceof KycError) return apiError(e.code, e.message, e.status, e.param);
  console.error("verification error", e);
  return apiError("INTERNAL_ERROR", "Something went wrong", 500);
}

export async function parseJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<{ data: z.infer<S>; response?: undefined } | { data?: undefined; response: Response }> {
  let body: unknown;
  try { body = await req.json(); } catch { return { response: apiError("INVALID_JSON", "Body must be JSON", 400) }; }
  const p = schema.safeParse(body);
  if (!p.success) return { response: apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join(".")) };
  return { data: p.data };
}

/** Load a case that belongs to the caller's organization (staff may read any case). */
export async function customerCase(req: NextRequest, id: string, opts: { edit?: boolean } = {}): Promise<{ user: AuthUser; c: FullCase; response?: undefined } | { response: Response; user?: undefined; c?: undefined }> {
  const g = await requireUser(req, opts.edit ? { roles: [...EDIT_ROLES] } : {});
  if (g.response) return { response: g.response };
  const c = await loadCase(id);
  if (!c || c.organizationId !== g.user.organizationId) return { response: apiError("NOT_FOUND", "Verification not found", 404) };
  return { user: g.user, c };
}
