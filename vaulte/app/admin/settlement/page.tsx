import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import SettlementStats from "@/components/admin/SettlementStats";

export default async function AdminSettlementPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!user.isStaff) redirect("/dashboard");
  return <SettlementStats />;
}
