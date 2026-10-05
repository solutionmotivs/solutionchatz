"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";

export default function StaffDocuments() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => { const r = await api("/api/admin/documents?status=RECEIVED"); if (r.ok) setRows(r.data.data); else { setErr(r.error?.message ?? "Failed"); setRows([]); } }, []);
  useEffect(() => { load(); }, [load]);
  async function decide(id: string, decision: string) {
    const note = decision === "REJECT" ? window.prompt("Why is this document rejected?") : undefined;
    if (decision === "REJECT" && !note) return;
    const r = await api(`/api/admin/documents/${id}`, { body: { decision, note } });
    if (!r.ok) setErr(r.error?.message ?? "Failed"); else load();
  }
  return (
    <Shell title="Documents awaiting check" back={{ href: "/admin", label: "Review queue" }}>
      <p className="text-[11px] text-mist max-w-2xl mb-6">Customer-uploaded certificates and proofs. Open the file, confirm it is genuine, issued for this transfer, and the number and amounts match; then verify. Verified documents cannot be changed.</p>
      {err && <ErrorBox message={err} />}
      <Section title="Queue">
        {rows === null ? <p className="text-[11px] text-mist">Loading…</p> : rows.length === 0 ? <p className="text-[12px] text-mist">Nothing waiting.</p> : rows.map(d => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 border-t border-ink/10 first:border-0 py-3 text-[12px]">
            <strong>{d.type}</strong><span>{d.number ?? "—"}</span><span className="text-mist">{d.organization} · transfer {d.transfer_id ? d.transfer_id.slice(-8) : "—"} · {d.issuer ?? ""}</span><Chip status={d.status} />
            {d.has_file ? <a className="text-gold hover:underline" target="_blank" rel="noreferrer" href={`/api/admin/documents/${d.id}/download`}>{d.filename}</a> : <span className="text-mist">reference only</span>}
            <button className="text-[#2D6A4F] text-[10px] uppercase tracking-widest" onClick={() => decide(d.id, "VERIFY")}>Verify</button>
            <button className="text-[#9B2C2C] text-[10px] uppercase tracking-widest" onClick={() => decide(d.id, "REJECT")}>Reject</button>
          </div>))}
      </Section>
    </Shell>
  );
}
