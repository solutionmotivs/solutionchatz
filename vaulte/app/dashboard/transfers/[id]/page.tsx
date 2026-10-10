import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import TransferDocuments from "@/components/dashboard/TransferDocuments";

export default async function TransferDetailPage({ params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return <TransferDocuments id={params.id} canEdit={["OWNER", "ADMIN", "FINANCE"].includes(user.role)} />;
}
