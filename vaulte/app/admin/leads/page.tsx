import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import StaffLeads from "@/components/admin/StaffLeads";

export default async function AdminLeadsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!user.isStaff) redirect("/dashboard");
  return <StaffLeads />;
}
