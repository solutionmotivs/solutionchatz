// What a payer may see for a Pay ID: the verified name, country, and the receiving instructions the licensed partners issued.
import { db } from "@/lib/db";
import { normaliseHandle, validateHandle } from "@/lib/pay-address";

export interface PublicPayId { handle: string; name: string; country: string; tagline: string | null; accounts: { currency: string; country: string; details: Record<string, string>; simulated: boolean }[] }

export async function resolvePayId(raw: string): Promise<PublicPayId | null> {
  const handle = normaliseHandle(decodeURIComponent(raw));
  if (validateHandle(handle)) return null; // not a possible handle: do not even query
  const r = await db.payAddress.findUnique({ where: { handle }, include: { entity: { select: { legalName: true, country: true, verificationStatus: true } } } });
  if (!r || r.status !== "ACTIVE" || r.entity.verificationStatus !== "APPROVED") return null;
  const vas = await db.virtualAccount.findMany({ where: { entityId: r.entityId, status: "ACTIVE" }, orderBy: { currency: "asc" } });
  return {
    handle, name: r.entity.legalName, country: r.entity.country, tagline: r.tagline,
    accounts: vas.map(v => ({ currency: v.currency, country: v.country, details: Object.fromEntries(Object.entries((v.details ?? {}) as Record<string, unknown>).filter(([, x]) => typeof x === "string")) as Record<string, string>, simulated: v.partner.startsWith("mock_") })),
  };
}
