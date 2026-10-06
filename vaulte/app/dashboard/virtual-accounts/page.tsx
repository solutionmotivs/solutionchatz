import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import VirtualAccountsClient from "@/components/dashboard/VirtualAccountsClient";

export default async function VirtualAccountsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const entities = await db.entity.findMany({ where: { organizationId: user.organizationId }, select: { id: true, legalName: true, country: true, currency: true, verificationStatus: true }, orderBy: { createdAt: "asc" } });
  return <VirtualAccountsClient role={user.role} entities={entities} />;
}
