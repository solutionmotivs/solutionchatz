import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import PartnersClient from "@/components/dashboard/PartnersClient";

export default async function PartnersPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return <PartnersClient role={user.role} />;
}
