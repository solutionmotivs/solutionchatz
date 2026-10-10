import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import VerificationCase from "@/components/verification/VerificationCase";

export default async function VerificationCasePage({ params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return <VerificationCase id={params.id} canEdit={["OWNER", "ADMIN"].includes(user.role)} />;
}
