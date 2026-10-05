// app/page.tsx
// Marketing landing page — server component
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import LandingPage from "@/components/LandingPage";

export default async function Home() {
  // Redirect logged-in users to dashboard
  const user = await getAuthUser();
  if (user) redirect("/dashboard");

  return <LandingPage />;
}
