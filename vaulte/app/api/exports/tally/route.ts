// GET /api/exports/tally — importable Tally voucher XML. ?pending=1 returns only transfers the bridge has not acknowledged
// (header X-Vaulte-Transfer-Ids lists them); otherwise ?from=&to= selects completed transfers by date.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError } from "@/lib/utils";
import { integrationContext } from "@/lib/erp/api";
import { tallyXml } from "@/lib/erp/tally";
import { transfersForVouchers } from "@/lib/erp/sync";
import { buildVoucher, homeCurrency, perspectiveFor, voucherBalanced, type ErpMapping, type Perspective } from "@/lib/erp/vouchers";

export async function GET(req: NextRequest) {
  const c = await integrationContext(req);
  if (c.response) return c.response;
  const q = req.nextUrl.searchParams;
  const conn = await db.erpConnection.findUnique({ where: { organizationId_provider: { organizationId: c.orgId, provider: "TALLY" } } });
  const mapping = ((conn?.mapping ?? {}) as ErpMapping);
  const pending = q.get("pending") === "1";
  const since = q.get("from") ? new Date(q.get("from")!) : pending ? conn?.syncFrom : undefined;
  const { org, items } = await transfersForVouchers(c.orgId, { since, until: q.get("to") ? new Date(q.get("to")!) : undefined, limit: Math.min(Number(q.get("limit") ?? 200), 500) });
  const done = pending ? new Set((await db.erpSyncRecord.findMany({ where: { organizationId: c.orgId, provider: "TALLY", status: { in: ["SYNCED", "SKIPPED"] } }, select: { transferId: true } })).map(r => r.transferId)) : new Set<string>();
  const base = mapping.base_currency ?? homeCurrency(org?.country ?? null);
  const forced = (q.get("perspective") ?? "AUTO") as Perspective | "AUTO";
  const vouchers = [], skipped: string[] = [];
  for (const { data } of items) {
    if (done.has(data.id)) continue;
    const v = buildVoucher(data, perspectiveFor(data, org?.country ?? null, forced));
    if (!voucherBalanced(v)) continue;
    if (v.currency !== base) { skipped.push(data.id); continue; }
    vouchers.push(v);
  }
  if (!vouchers.length && !skipped.length && pending) return new Response(null, { status: 204 });
  return new Response(tallyXml(vouchers, mapping), { headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": 'attachment; filename="vaulte-tally-vouchers.xml"', "X-Vaulte-Transfer-Ids": vouchers.map(v => v.transferId).join(","), "X-Vaulte-Skipped-Currency-Mismatch": skipped.join(","), "X-Vaulte-Base-Currency": base, "Cache-Control": "private, no-store" } });
}
