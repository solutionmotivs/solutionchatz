import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import LedgerAdmin from "@/components/admin/LedgerAdmin";

export default async function LedgerPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (!user.isStaff) redirect("/dashboard");
  return <LedgerAdmin />;
}
