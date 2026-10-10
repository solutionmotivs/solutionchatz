import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiSuccess } from "@/lib/utils";
import { presentDocument } from "@/lib/documents/service";

/** GET ?status=RECEIVED — customer-uploaded documents awaiting a staff check. */
export async function GET(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const status = req.nextUrl.searchParams.get("status") ?? "RECEIVED";
  const rows = await db.document.findMany({ where: { status }, orderBy: { createdAt: "asc" }, take: 200 });
  const orgs = await db.organization.findMany({ where: { id: { in: rows.map(r => r.organizationId) } }, select: { id: true, name: true } });
  const name = new Map(orgs.map(o => [o.id, o.name]));
  return apiSuccess({ data: rows.map(r => ({ ...presentDocument(r), organization: name.get(r.organizationId) })) });
}
