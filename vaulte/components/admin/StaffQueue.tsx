"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client-api";
import { Chip, Shell } from "@/components/verification/shared";

const TABS: Array<[string, string]> = [["IN_REVIEW", "In review"], ["NEEDS_INFO", "Waiting on customer"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"], ["DUE_REVIEW", "Review due (30 days)"]];

export default function StaffQueue({ totpEnabled, name }: { totpEnabled: boolean; name: string }) {
  const [tab, setTab] = useState("IN_REVIEW");
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setRows(null);
    api(`/api/admin/verification?status=${tab}`).then(r => { if (r.ok) setRows(r.data.data); else { setErr(r.error?.message ?? "Failed"); setRows([]); } });
  }, [tab]);
  return (
    <Shell title="Compliance review queue" right={<><Link href="/admin/sanctions" className="text-gold hover:underline">Sanctions</Link><Link href="/admin/ledger" className="text-gold hover:underline">Ledger</Link><Link href="/admin/documents" className="text-gold hover:underline">Documents</Link><Link href="/admin/escrow" className="text-gold hover:underline">Escrow</Link></>}>
      <p className="text-[11px] text-mist mb-6">Signed in as {name}.{!totpEnabled && " Turn on two-factor authentication in Account → Security to open cases."}</p>
      <div className="flex gap-1 border-b border-ink/10 mb-6 overflow-x-auto">
        {TABS.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`px-4 py-3 text-[11px] uppercase tracking-widest whitespace-nowrap ${tab === id ? "text-ink border-b-2 border-gold" : "text-mist hover:text-ink"}`}>{label}</button>)}
      </div>
      {err && <p className="text-[12px] text-[#9B2C2C] mb-4">{err}</p>}
      {rows === null ? <p className="text-[11px] text-mist">Loading…</p> : rows.length === 0 ? <p className="text-[11px] text-mist">Nothing here.</p> : (
        <table className="w-full text-[12px]">
          <thead><tr className="text-left text-[9px] uppercase tracking-widest text-mist"><th className="py-2">Subject</th><th>Account</th><th>Type</th><th>Country</th><th>Level</th><th>Risk</th><th>Submitted</th><th></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id} className="border-t border-ink/10">
              <td className="py-3">{r.subject_name}</td><td>{r.organization}</td><td>{r.kind}</td><td>{r.country}</td>
              <td>{r.tier ?? "—"}{r.approvals > 0 && r.status === "IN_REVIEW" ? ` (${r.approvals} approval)` : ""}</td>
              <td>{r.blocked ? <Chip status="REJECTED" label="Blocked" /> : r.risk_score ?? "—"}</td>
              <td>{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "—"}</td>
              <td className="text-right"><Link className="text-gold hover:underline" href={`/admin/verification/${r.id}`}>Review →</Link></td>
            </tr>))}</tbody>
        </table>
      )}
    </Shell>
  );
}
