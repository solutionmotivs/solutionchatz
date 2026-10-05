"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";

export default function StaffDocuments() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const [reqs, setReqs] = useState<any[]>([]);
  const load = useCallback(async () => {
    const r = await api("/api/admin/documents?status=RECEIVED"); if (r.ok) setRows(r.data.data); else { setErr(r.error?.message ?? "Failed"); setRows([]); }
    const q = await api("/api/admin/document-requests?status=OPEN"); if (q.ok) setReqs(q.data.data);
  }, []);
  async function deliver(id: string, file: File | undefined) {
    const number = window.prompt("Certificate number (optional)") ?? "";
    const fd = new FormData(); if (number) fd.set("number", number); if (file) fd.set("file", file);
    if (!file && !number) return;
    const res = await fetch(`/api/admin/document-requests/${id}/deliver`, { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setErr(j?.error?.message ?? "Failed"); else load();
  }
  async function updateReq(id: string, status: string) {
    const note = status === "REJECTED" ? window.prompt("Why is the request rejected? (the customer sees this)") : undefined;
    if (status === "REJECTED" && !note) return;
    const r = await api(`/api/admin/document-requests/${id}`, { body: { status, note } });
    if (!r.ok) setErr(r.error?.message ?? "Failed"); else load();
  }
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
      <Section title="Certificate requests" hint="Customers asked for these. Ask the issuing partner or bank, then attach what they send: the request closes and the customer is emailed.">
        {reqs.length === 0 ? <p className="text-[12px] text-mist">No open requests.</p> : reqs.map(r => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-t border-ink/10 first:border-0 py-3 text-[12px]">
            <strong>{r.type}</strong><span className="text-mist">{r.organization} · transfer {r.transfer_id.slice(-8)} · partner ref {r.partner_ref ?? "—"} · {r.dest_country} {r.purpose_code ?? ""}</span><Chip status={r.status === "IN_PROGRESS" ? "IN_REVIEW" : "NEEDS_INFO"} label={r.status.replace("_", " ")} />
            {r.note && <span className="text-mist">“{r.note}”</span>}
            <label className="text-gold hover:underline cursor-pointer text-[10px] uppercase tracking-widest">Attach<input type="file" className="hidden" accept="application/pdf,image/png,image/jpeg" onChange={e => { deliver(r.id, e.target.files?.[0]); e.target.value = ""; }} /></label>
            {r.status === "REQUESTED" && <button className="text-[10px] uppercase tracking-widest text-slate" onClick={() => updateReq(r.id, "IN_PROGRESS")}>Mark in progress</button>}
            <button className="text-[#9B2C2C] text-[10px] uppercase tracking-widest" onClick={() => updateReq(r.id, "REJECTED")}>Reject</button>
          </div>))}
      </Section>
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
