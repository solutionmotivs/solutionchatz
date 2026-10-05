import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import IntegrationsClient from "@/components/dashboard/IntegrationsClient";

export default async function IntegrationsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return <IntegrationsClient canManage={["OWNER", "ADMIN"].includes(user.role)} />;
}
