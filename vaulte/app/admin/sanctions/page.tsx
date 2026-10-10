import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import SanctionsAlerts from "@/components/admin/SanctionsAlerts";

export default async function SanctionsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!user.isStaff) redirect("/dashboard");
  return <SanctionsAlerts />;
}
