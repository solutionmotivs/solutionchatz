// Staff-only endpoints are protected by a shared secret header (ADMIN_API_TOKEN).
// This is a stop-gap until proper staff accounts/roles exist; keep the token out of client code.
import { timingSafeEqual } from "crypto";

export function isAdminRequest(req: Request, envName = "ADMIN_API_TOKEN", header = "x-admin-token"): boolean {
  const expected = process.env[envName];
  if (!expected || expected.length < 24) return false;
  const given = req.headers.get(header) ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
