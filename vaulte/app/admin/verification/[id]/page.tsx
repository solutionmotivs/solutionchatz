import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import StaffCase from "@/components/admin/StaffCase";

export default async function AdminCasePage({ params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!user.isStaff) redirect("/dashboard");
  return <StaffCase id={params.id} staffId={user.id} />;
}
