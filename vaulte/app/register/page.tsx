import RegisterClient from "@/components/auth/RegisterClient";
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function RegisterPage() {
  if (await getAuthUser()) redirect("/dashboard");
  return <RegisterClient />;
}
