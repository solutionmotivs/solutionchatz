// app/dashboard/page.tsx
import { getAuthUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import DashboardClient from "@/components/dashboard/DashboardClient";

export default async function DashboardPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  // Fetch stats server-side for fast initial render
  const orgId = user.organizationId;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [totalPayments, settledPayments, pendingPayments, volumeResult, recentPayments, org] =
    await Promise.all([
      db.payment.count({ where: { organizationId: orgId, createdAt: { gte: monthStart } } }),
      db.payment.count({ where: { organizationId: orgId, status: "SETTLED", createdAt: { gte: monthStart } } }),
      db.payment.count({ where: { organizationId: orgId, status: { in: ["PROCESSING", "PENDING_COMPLIANCE"] } } }),
      db.payment.aggregate({
        where: { organizationId: orgId, status: "SETTLED", createdAt: { gte: monthStart } },
        _sum: { amountUsd: true },
      }),
      db.payment.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          senderEntity: { select: { legalName: true } },
          recipientEntity: { select: { legalName: true } },
        },
      }),
      db.organization.findUnique({
        where: { id: orgId },
        select: { kybStatus: true, riskTier: true, planId: true, dailyLimitUsd: true },
      }),
    ]);

  const volumeUsd = Number(volumeResult._sum.amountUsd ?? 0) / 100;

  return (
    <DashboardClient
      user={user}
      stats={{ totalPayments, settledPayments, pendingPayments, volumeUsd }}
      recentPayments={recentPayments.map(p => ({
        id: p.id,
        senderName: p.senderEntity.legalName,
        recipientName: p.recipientEntity.legalName,
        amount: Number(p.amount),
        currency: p.currency,
        status: p.status,
        rail: p.railSelected ?? p.rail,
        createdAt: p.createdAt.toISOString(),
      }))}
      org={org}
    />
  );
}
