"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";

const TYPES: Array<[string, string]> = [["EFIRA", "eFIRA"], ["FIRC", "FIRC"], ["EBRC", "eBRC"], ["BRC", "BRC"], ["BANK_CERT", "Bank certificate"], ["INVOICE_COPY", "Invoice copy"], ["SHIPPING_BILL", "Shipping bill"], ["PURPOSE_PROOF", "Purpose proof"], ["OTHER", "Other"]];

export default function TransferDocuments({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [reqs, setReqs] = useState<any[]>([]);
  const [f, setF] = useState({ type: "EFIRA", number: "", issuer: "", issued_on: "" });
  const load = useCallback(async () => {
    const r = await api(`/api/transfers/${id}/documents`);
    if (r.ok) setData(r.data); else setErr(r.error?.message ?? "Could not load");
  }, [id]);
  const loadReqs = useCallback(async () => { const r = await api(`/api/transfers/${id}/document-requests`); if (r.ok) setReqs(r.data.data); }, [id]);
  useEffect(() => { load(); loadReqs(); }, [load, loadReqs]);
  async function request(type: string) {
    setErr("");
    const r = await api(`/api/transfers/${id}/document-requests`, { body: { type } });
    if (!r.ok) return setErr(r.error?.message ?? "Could not request");
    loadReqs();
  }

  async function upload(file: File | undefined) {
    setErr(""); setBusy(true);
    const fd = new FormData(); fd.set("type", f.type); fd.set("transfer_id", id);
    for (const k of ["number", "issuer", "issued_on"] as const) if ((f as any)[k]) fd.set(k, (f as any)[k]);
    if (file) fd.set("file", file);
    const res = await fetch("/api/documents", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j?.error?.message ?? "Upload failed");
    setF({ ...f, number: "", issuer: "", issued_on: "" }); load();
  }

  return (
    <Shell title="Transfer documents" back={{ href: "/dashboard/transfers", label: "Transfers" }}>
      <div className="flex flex-wrap gap-4 mb-6">
        <a className="btn-gold" href={`/api/transfers/${id}/pack`}>Download realisation pack (PDF)</a>
        <a className="btn-ghost" href={`/api/transfers/${id}/advice`}>Payment advice (PDF)</a>
      </div>
      <p className="text-[11px] text-mist leading-relaxed max-w-3xl mb-6">The payment advice is Vaulte&apos;s own record. It is not an eFIRA, FIRC or eBRC: those are issued by your bank, our licensed partner or DGFT, and appear here when they arrive or when you upload them.</p>
      {err && <ErrorBox message={err} />}
      {!data ? <p className="text-[11px] text-mist">Loading…</p> : (
        <>
          <Section title="What this transfer needs" hint={data.complete ? "Everything required so far is on file." : "Items marked pending are still outstanding."}>
            {data.checklist.length === 0 ? <p className="text-[12px] text-mist">No specific trade documents are expected for this transfer.</p> : data.checklist.map((c: any) => (
              <div key={c.type} className="flex flex-wrap items-center gap-3 border-t border-ink/10 first:border-0 py-3 text-[12px]">
                <Chip status={c.status === "PRESENT" ? "APPROVED" : c.status === "PENDING" ? "NEEDS_INFO" : "DRAFT"} label={c.status.replace("_", " ")} /><strong>{c.label}</strong>
                <span className="text-mist">from {c.from}</span>
                {c.status === "PENDING" && canEdit && ["EFIRA", "EBRC"].includes(c.type) && !reqs.some(r => r.type === c.type && ["REQUESTED", "IN_PROGRESS"].includes(r.status)) && <button className="text-gold hover:underline text-[11px]" onClick={() => request(c.type)}>Request it</button>}
                {c.detail && <span className="text-mist w-full">{c.detail}</span>}
              </div>))}
          </Section>
          <Section title="Certificate requests" hint="Certificates are issued by your bank, the licensed partner or DGFT. We ask them for you and attach the document here when it arrives.">
            {reqs.length === 0 ? <p className="text-[12px] text-mist">No requests yet.</p> : reqs.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 border-t border-ink/10 first:border-0 py-2 text-[12px]">
                <strong>{r.type}</strong><Chip status={r.status === "FULFILLED" ? "APPROVED" : r.status === "REJECTED" ? "REJECTED" : "IN_REVIEW"} label={r.status.replace("_", " ")} />
                <span className="text-mist">requested {new Date(r.created_at).toLocaleDateString()}</span>{r.staff_note && <span className="text-[#9A4B12]">{r.staff_note}</span>}
              </div>))}
            {canEdit && data.requestable && (
              <div className="flex flex-wrap gap-2 mt-3">{(data.requestable as string[]).map(t => <button key={t} className="btn-ghost !py-2 !px-3 text-[10px]" onClick={() => request(t)}>Request {t}</button>)}</div>
            )}
          </Section>
          <Section title="On file">
            {data.data.length === 0 ? <p className="text-[12px] text-mist">Nothing yet.</p> : data.data.map((d: any) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 border-t border-ink/10 first:border-0 py-2 text-[12px]">
                <strong>{d.type}</strong>{d.number && <span>{d.number}</span>}<span className="text-mist">{d.issuer ?? ""}{d.issued_on ? ` · ${new Date(d.issued_on).toLocaleDateString()}` : ""}</span>
                <Chip status={d.status} />{d.source === "PARTNER" && <span className="text-[10px] text-mist">received from partner</span>}
                {d.has_file ? <a className="text-gold hover:underline" href={`/api/documents/${d.id}/download`}>{d.filename}</a> : <span className="text-mist">reference only</span>}
                {d.note && <span className="text-[#9B2C2C]">{d.note}</span>}
              </div>))}
          </Section>
          {canEdit && (
            <Section title="Add a certificate or document" hint="Upload what your bank or the partner sent you, or enter just the certificate number. Our team checks uploads before they are marked verified.">
              <div className="grid sm:grid-cols-4 gap-3 mb-3">
                <select className="input-field" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <input className="input-field" placeholder="Certificate number" value={f.number} onChange={e => setF({ ...f, number: e.target.value })} />
                <input className="input-field" placeholder="Issued by" value={f.issuer} onChange={e => setF({ ...f, issuer: e.target.value })} />
                <input className="input-field" type="date" value={f.issued_on} onChange={e => setF({ ...f, issued_on: e.target.value })} />
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="btn-ghost cursor-pointer">{busy ? "Uploading…" : "Choose file (PDF/PNG/JPEG)"}<input type="file" className="hidden" accept="application/pdf,image/png,image/jpeg" onChange={e => { upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
                <button className="btn-primary disabled:opacity-40" disabled={!f.number || busy} onClick={() => upload(undefined)}>Save number only</button>
              </div>
            </Section>
          )}
          <p className="text-[10px] text-mist mt-6 max-w-3xl">{data.retention_note}</p>
        </>
      )}
    </Shell>
  );
}
