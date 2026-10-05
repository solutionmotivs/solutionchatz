import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { TERMS_VERSION } from "@/lib/auth-flows";
import TermsBanner from "@/components/legal/TermsBanner";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();
  const row = user ? await db.user.findUnique({ where: { id: user.id }, select: { termsVersion: true } }) : null;
  const outdated = !!row && row.termsVersion !== TERMS_VERSION;
  return <>{outdated && <TermsBanner version={TERMS_VERSION} accepted={row?.termsVersion ?? null} />}{children}</>;
}
