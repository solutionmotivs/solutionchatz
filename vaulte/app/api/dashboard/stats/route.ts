// app/api/dashboard/stats/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";

export async function GET(_req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return apiError("UNAUTHORIZED", "Not authenticated", 401);

  const orgId = user.organizationId;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [
    totalPayments, settledPayments, failedPayments, pendingPayments,
    volumeResult, prevVolumeResult, recentPayments,
  ] = await Promise.all([
    db.payment.count({ where: { organizationId: orgId, createdAt: { gte: monthStart } } }),
    db.payment.count({ where: { organizationId: orgId, status: "SETTLED", createdAt: { gte: monthStart } } }),
    db.payment.count({ where: { organizationId: orgId, status: "FAILED", createdAt: { gte: monthStart } } }),
    db.payment.count({ where: { organizationId: orgId, status: { in: ["PROCESSING", "PENDING_COMPLIANCE", "COMPLIANCE_CLEARED"] } } }),
    db.payment.aggregate({
      where: { organizationId: orgId, status: "SETTLED", createdAt: { gte: monthStart } },
      _sum: { amountUsd: true },
    }),
    db.payment.aggregate({
      where: { organizationId: orgId, status: "SETTLED", createdAt: { gte: prevMonthStart, lt: monthStart } },
      _sum: { amountUsd: true },
    }),
    db.payment.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        senderEntity: { select: { legalName: true } },
        recipientEntity: { select: { legalName: true } },
      },
    }),
  ]);

  const currentVolumeUsd = Number(volumeResult._sum.amountUsd ?? 0) / 100;
  const prevVolumeUsd = Number(prevVolumeResult._sum.amountUsd ?? 0) / 100;
  const volumeChange = prevVolumeUsd > 0
    ? ((currentVolumeUsd - prevVolumeUsd) / prevVolumeUsd) * 100
    : 0;

  // Volume chart — last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dailyVolume = await db.payment.groupBy({
    by: ["createdAt"],
    where: { organizationId: orgId, status: "SETTLED", createdAt: { gte: thirtyDaysAgo } },
    _sum: { amountUsd: true },
    orderBy: { createdAt: "asc" },
  });

  return apiSuccess({
    stats: {
      total_volume_usd: currentVolumeUsd,
      volume_change_pct: Math.round(volumeChange * 10) / 10,
      total_payments: totalPayments,
      settled_payments: settledPayments,
      failed_payments: failedPayments,
      pending_payments: pendingPayments,
      success_rate: totalPayments > 0
        ? Math.round((settledPayments / totalPayments) * 100 * 10) / 10
        : 100,
    },
    recent_transactions: recentPayments.map(p => ({
      id: p.id,
      sender_name: p.senderEntity.legalName,
      recipient_name: p.recipientEntity.legalName,
      amount: Number(p.amount),
      currency: p.currency,
      amount_usd: Number(p.amountUsd ?? 0) / 100,
      status: p.status,
      rail: p.railSelected ?? p.rail,
      created_at: p.createdAt.toISOString(),
    })),
    volume_chart: dailyVolume.map(d => ({
      date: d.createdAt.toISOString().split("T")[0],
      volume_usd: Number(d._sum.amountUsd ?? 0) / 100,
    })),
  });
}
