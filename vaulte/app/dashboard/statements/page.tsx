import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import StatementClient from "@/components/dashboard/StatementClient";

export default async function StatementsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return <StatementClient />;
}
