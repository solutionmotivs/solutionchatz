import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import SellerEscrow from "@/components/escrow/SellerEscrow";

export default async function EscrowPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const entities = await db.entity.findMany({ where: { organizationId: user.organizationId }, select: { id: true, legalName: true, country: true, currency: true, entityType: true }, orderBy: { createdAt: "asc" } });
  const org = await db.organization.findUnique({ where: { id: user.organizationId }, select: { kybStatus: true } });
  return <SellerEscrow role={user.role} entities={entities} live={org?.kybStatus === "APPROVED"} />;
}
