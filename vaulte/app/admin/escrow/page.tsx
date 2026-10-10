import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import StaffEscrow from "@/components/admin/StaffEscrow";

export default async function AdminEscrowPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!user.isStaff) redirect("/dashboard");
  return <StaffEscrow />;
}
