import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import StaffDocuments from "@/components/admin/StaffDocuments";

export default async function AdminDocumentsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!user.isStaff) redirect("/dashboard");
  return <StaffDocuments />;
}
