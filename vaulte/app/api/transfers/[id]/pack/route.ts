// GET /api/transfers/:id/pack — realisation pack PDF (advice + timeline + ledger extract + checklist + attached certificates).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError } from "@/lib/utils";
import { fingerprint, loadPackData, realisationPackPdf } from "@/lib/documents/pdf";
import { orgContext } from "@/lib/documents/api";
import { hit } from "@/lib/security/ratelimit-db";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const c = await orgContext(req);
  if (c.response) return c.response;
  if (!(await hit(`doc:pack:${c.orgId}`, 30, 3600)).allowed) return apiError("RATE_LIMITED", "Too many pack downloads. Try again later.", 429);
  const d = await loadPackData(params.id, c.orgId);
  if (!d) return apiError("NOT_FOUND", "Transfer not found", 404);
  const pdf = await realisationPackPdf(d);
  await db.auditLog.create({ data: { organizationId: c.orgId, userId: c.userId ?? null, action: "document.pack_generated", resourceType: "Transfer", resourceId: params.id, metadata: { fingerprint: fingerprint(d), bytes: pdf.length } } });
  return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="realisation-pack-${params.id.slice(-8)}.pdf"`, "Cache-Control": "private, no-store" } });
}
