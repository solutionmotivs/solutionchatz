// Trade checks at transfer time: the HS codes on the invoice behind a transfer decide whether it is refused or held for a staff check.
import { db } from "@/lib/db";
import { tradeFlags, type TradeFlag } from "./risk";

export async function flagsForInvoice(invoiceId: string | null | undefined): Promise<TradeFlag[]> {
  if (!invoiceId) return [];
  const lines = await db.invoiceLineItem.findMany({ where: { invoiceId }, select: { hsCode: true } });
  return tradeFlags(lines.map(l => l.hsCode ?? "").filter(Boolean));
}

/** Reason string for a staff hold, or null when nothing needs review (or a staff member already released this transfer). */
export async function tradeReviewReason(transferId: string, invoiceId: string | null | undefined): Promise<string | null> {
  const review = (await flagsForInvoice(invoiceId)).filter(f => f.severity === "REVIEW");
  if (!review.length) return null;
  if (await db.auditLog.count({ where: { action: "transfer.review.release", resourceId: transferId } })) return null;
  return `TRADE_REVIEW: ${Array.from(new Set(review.map(f => f.code))).join(",")}`;
}
