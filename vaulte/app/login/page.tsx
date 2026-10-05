// app/login/page.tsx
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import LoginClient from "@/components/auth/LoginClient";

export default async function LoginPage() {
  const user = await getAuthUser();
  if (user) redirect("/dashboard");
  return <LoginClient />;
}
