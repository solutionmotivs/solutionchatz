// app/onboarding/page.tsx
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import OnboardingClient from "@/components/onboarding/OnboardingClient";

export default async function OnboardingPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const org = await db.organization.findUnique({
    where: { id: user.organizationId },
    select: {
      onboardingStep: true, onboardingDone: true,
      kybStatus: true, name: true, country: true,
      legalName: true, registrationNumber: true,
      taxId: true, businessType: true,
    },
  });

  if (!org) redirect("/dashboard");
  if (org.onboardingDone) redirect("/dashboard");

  return <OnboardingClient user={user} org={org} />;
}
