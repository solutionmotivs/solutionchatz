import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import ProfileClient from "@/components/dashboard/ProfileClient";

export default async function ProfilePage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return <ProfileClient role={user.role} isStaff={user.isStaff} />;
}
