// GET /api/virtual-accounts/capabilities — which currencies/countries can be opened right now, for this account's mode.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiSuccess } from "@/lib/utils";
import { invoiceAuth } from "@/lib/invoices/auth";
import { vaOptions } from "@/lib/psp/capabilities";

export async function GET(req: NextRequest) {
  const a = await invoiceAuth(req, false);
  if (a.response) return a.response;
  const org = await db.organization.findUnique({ where: { id: a.organizationId }, select: { kybStatus: true } });
  const sandbox = org?.kybStatus !== "APPROVED";
  return apiSuccess({ mode: sandbox ? "test" : "live", options: vaOptions(sandbox), note: sandbox ? "Test mode: simulated partners. Live options appear after verification and only for partners contracted and configured for live use." : "Live: only contracted partners with live credentials. Partners enable currencies per account; the list is documented capability, confirmed when the account is opened." });
}
