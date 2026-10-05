// GET — the vendor redirects the user's browser here after consent. Exchanges the code for tokens (stored encrypted).
import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/log";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { ADAPTERS } from "@/lib/erp/connectors";
import { providerOf } from "@/lib/erp/api";
import { readState, redirectUri, storeTokens } from "@/lib/erp/sync";

export async function GET(req: NextRequest, { params }: { params: { provider: string } }) {
  const back = (q: string) => NextResponse.redirect(new URL(`/dashboard/integrations?${q}`, process.env.NEXT_PUBLIC_APP_URL ?? req.url));
  const p = providerOf(params.provider);
  if (!p || p === "TALLY") return back("error=unknown_provider");
  const user = await getAuthUser();
  const q = Object.fromEntries(req.nextUrl.searchParams);
  const st = q.state ? readState(q.state) : null;
  if (!user || !st || st.provider !== p || st.org !== user.organizationId || st.user !== user.id) return back("error=invalid_or_expired_state");
  if (q.error || !q.code) return back(`error=${encodeURIComponent(q.error ?? "no_code")}`);
  try {
    const r = await ADAPTERS[p].connect(q.code, redirectUri(p), q);
    const data = { status: "CONNECTED", tenant: r.tenant, lastError: null, ...storeTokens(r.tokens) };
    await db.erpConnection.upsert({ where: { organizationId_provider: { organizationId: user.organizationId, provider: p } }, update: data, create: { organizationId: user.organizationId, provider: p, ...data } });
    await db.auditLog.create({ data: { organizationId: user.organizationId, userId: user.id, action: "erp.connected", resourceType: "ErpConnection", resourceId: p } });
    return back(`connected=${p}`);
  } catch (e) {
    log("error", "erp connect failed", { provider: p, error: e });
    return back("error=connection_failed");
  }
}
