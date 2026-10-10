import { fmtMinor } from "@/lib/currency";
// /dashboard/transfers — cross-border transfers, virtual accounts and Vaulte markup earned.
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

const usd = (cents: bigint | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents) / 100);
const money = (minor: bigint, currency: string) => fmtMinor(minor, currency);

export default async function TransfersPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const orgId = user.organizationId;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [transfers, earned, volume, held, accounts] = await Promise.all([
    db.transfer.findMany({
      where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 25,
      include: { sender: { select: { legalName: true } }, recipient: { select: { legalName: true } } },
    }),
    db.transfer.aggregate({ where: { organizationId: orgId, status: "COMPLETED", createdAt: { gte: monthStart } }, _sum: { markupUsd: true } }),
    db.transfer.aggregate({ where: { organizationId: orgId, status: "COMPLETED", createdAt: { gte: monthStart } }, _sum: { sourceAmountUsd: true } }),
    db.transfer.count({ where: { organizationId: orgId, status: "QUARANTINED" } }),
    db.virtualAccount.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return (
    <div className="min-h-screen bg-paper px-8 py-10 font-mono">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-serif text-3xl text-ink">Transfers</h1>
          <Link href="/dashboard" className="text-[10px] uppercase tracking-widest text-mist hover:text-ink">← Dashboard</Link>
        </div>

        <div className="grid grid-cols-3 gap-px bg-ink/10 border border-ink/10 mb-10">
          {[
            ["Completed volume (this month)", usd(volume._sum.sourceAmountUsd ?? 0n)],
            ["Vaulte markup earned (this month)", usd(earned._sum.markupUsd ?? 0n)],
            ["On hold for review", String(held)],
          ].map(([k, v]) => (
            <div key={k} className="bg-paper p-6">
              <div className="font-serif text-3xl text-ink mb-1">{v}</div>
              <div className="text-[9px] uppercase tracking-widest text-mist">{k}</div>
            </div>
          ))}
        </div>

        <div className="border border-ink/10 mb-10 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-cream/60 text-[9px] uppercase tracking-widest text-mist text-left">
                {["When", "From → To", "Sent", "Received", "Route", "Status", ""].map(h => <th key={h} className="px-4 py-3 font-normal">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {transfers.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-mist">No transfers yet. Create a quote with POST /api/quotes.</td></tr>
              )}
              {transfers.map(t => {
                const route = t.route as unknown as { token: string | null; partners: string[] };
                return (
                  <tr key={t.id} className="border-t border-ink/5">
                    <td className="px-4 py-3 text-mist">{t.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td className="px-4 py-3 text-ink">{t.sender.legalName} → {t.recipient.legalName}</td>
                    <td className="px-4 py-3">{money(t.sourceAmount, t.sourceCurrency)}</td>
                    <td className="px-4 py-3">{money(t.destAmount, t.destCurrency)}</td>
                    <td className="px-4 py-3 text-mist">{route.token ?? "bank rails"} · {route.partners?.length ?? 0} partner(s)</td>
                    <td className="px-4 py-3">
                      <span className="status-pill status-draft text-[8px]">{t.status.replace(/_/g, " ")}</span>
                      {t.statusReason && <div className="text-[9px] text-mist mt-1">{t.statusReason}</div>}
                    </td>
                    <td className="px-4 py-3 text-right"><Link href={`/dashboard/transfers/${t.id}`} className="text-gold hover:underline">Details & documents →</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2 className="font-serif text-xl text-ink mb-4">Virtual accounts</h2>
        <div className="border border-ink/10">
          {accounts.length === 0 ? (
            <div className="px-4 py-6 text-[11px] text-mist">None yet. Open one with POST /api/virtual-accounts.</div>
          ) : accounts.map(a => (
            <div key={a.id} className="px-4 py-3 border-b border-ink/5 last:border-b-0 text-[11px] flex justify-between">
              <span className="text-ink">{a.currency} · {a.country}</span>
              <span className="text-mist">sweeps to {(a.sweepRule as { destCurrency?: string }).destCurrency} on every credit</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-mist mt-8">Vaulte does not hold funds. Licensed partners receive, convert and pay out.</p>
      </div>
    </div>
  );
}
