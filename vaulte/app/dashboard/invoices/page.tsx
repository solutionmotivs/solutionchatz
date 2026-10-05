import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import InvoicesClient from "@/components/dashboard/InvoicesClient";

export default async function InvoicesPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const entities = await db.entity.findMany({ where: { organizationId: user.organizationId }, select: { id: true, legalName: true, country: true, currency: true }, orderBy: { createdAt: "asc" } });
  return <InvoicesClient role={user.role} entities={entities} />;
}
