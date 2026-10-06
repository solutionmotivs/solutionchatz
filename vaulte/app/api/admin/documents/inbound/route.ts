// GET /api/admin/documents/inbound?status=UNMATCHED — staff queue of emailed certificates that could not be matched to one transfer.
// Attachments of unmatched messages are NOT stored (no organisation to file them under): ask the sender to resend with the transfer reference.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiSuccess } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  const status = req.nextUrl.searchParams.get("status") ?? "UNMATCHED";
  const rows = await db.inboundMessage.findMany({ where: { status: { in: status === "ALL" ? ["MATCHED", "UNMATCHED", "AMBIGUOUS", "REJECTED"] : [status] } }, orderBy: { receivedAt: "desc" }, take: 100 });
  return apiSuccess({ data: rows.map(r => ({ id: r.id, received_at: r.receivedAt.toISOString(), from: r.fromAddr, subject: r.subject, status: r.status, note: r.note, transfer_id: r.transferId, document_ids: r.documentIds })) });
}
