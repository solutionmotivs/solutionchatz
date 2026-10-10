import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import StaffQueue from "@/components/admin/StaffQueue";

export default async function AdminPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!user.isStaff) redirect("/dashboard");
  return <StaffQueue totpEnabled={user.totpEnabled} name={user.name} />;
}
