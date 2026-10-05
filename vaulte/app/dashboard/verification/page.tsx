import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import VerificationList from "@/components/verification/VerificationList";

export default async function VerificationPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const [org, entities] = await Promise.all([
    db.organization.findUnique({ where: { id: user.organizationId }, select: { accountType: true, country: true, name: true } }),
    db.entity.findMany({ where: { organizationId: user.organizationId }, select: { id: true, legalName: true, country: true, entityType: true, verificationStatus: true }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  return <VerificationList role={user.role} accountType={org?.accountType ?? "BUSINESS"} country={org?.country ?? ""} orgName={org?.name ?? ""} entities={entities} />;
}
