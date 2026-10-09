import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import PayIdClient from "@/components/dashboard/PayIdClient";

export default async function PayIdPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const entities = await db.entity.findMany({ where: { organizationId: user.organizationId, verificationStatus: "APPROVED" }, select: { id: true, legalName: true }, orderBy: { createdAt: "asc" } });
  return <PayIdClient role={user.role} entities={entities} />;
}
