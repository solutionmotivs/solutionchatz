"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";

export default function PayIdClient({ role, entities }: { role: string; entities: { id: string; legalName: string }[] }) {
  const canWrite = ["OWNER", "ADMIN", "FINANCE"].includes(role);
  const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [f, setF] = useState({ handle: "", entity: entities[0]?.id ?? "", tagline: "" });
  const load = useCallback(async () => { const r = await api("/api/pay-addresses"); if (r.ok) setRows(r.data.data); }, []);
  useEffect(() => { load(); }, [load]);
  async function claim() {
    setErr(""); setMsg("");
    const r = await api("/api/pay-addresses", { body: { handle: f.handle, entity_id: f.entity, ...(f.tagline ? { tagline: f.tagline } : {}) } });
    if (!r.ok) return setErr(r.error?.message ?? "Could not claim that Pay ID");
    setMsg(`${r.data.address} is yours. Share ${r.data.url}`); setF({ ...f, handle: "", tagline: "" }); load();
  }
  async function toggle(id: string, status: string) { const r = await api(`/api/pay-addresses/${id}`, { method: "PATCH", body: { status: status === "ACTIVE" ? "DISABLED" : "ACTIVE" } }); if (r.ok) load(); else setErr(r.error?.message ?? "Could not change it"); }
  return (
    <Shell title="Pay ID" right={<a className="text-mist hover:text-ink" href="/dashboard">Dashboard</a>}>
      <p className="text-[12px] text-slate leading-relaxed max-w-2xl mb-6">A short address such as <strong>acme@vaulte</strong> that opens a page with your verified name and your receiving accounts in every currency, with a QR code. Payers pick the right account without asking you for bank details. It only points to accounts issued by licensed partners in your name; it holds no money.</p>
      {err && <ErrorBox message={err} />}{msg && <div className="border border-[#2D6A4F]/40 bg-[#2D6A4F]/5 px-4 py-3 text-[12px] mb-6">{msg}</div>}
      {canWrite && (
        <Section title="Claim a Pay ID" hint={entities.length ? "One per verified account holder. Pick something payers will recognise." : "Only a verified account holder can have a Pay ID. Complete verification for an entity first."}>
          {entities.length > 0 && (
            <div className="grid sm:grid-cols-3 gap-3 items-end">
              <div><label className="label-text">Handle</label><div className="flex items-center gap-1"><input className="input-field" value={f.handle} onChange={e => setF({ ...f, handle: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30) })} placeholder="acme" /><span className="text-[12px] text-mist">@vaulte</span></div></div>
              <div><label className="label-text">Account holder</label><select className="input-field" value={f.entity} onChange={e => setF({ ...f, entity: e.target.value })}>{entities.map(e => <option key={e.id} value={e.id}>{e.legalName}</option>)}</select></div>
              <div><label className="label-text">Tagline (optional)</label><input className="input-field" value={f.tagline} onChange={e => setF({ ...f, tagline: e.target.value })} maxLength={120} /></div>
              <div className="sm:col-span-3"><button className="btn-primary disabled:opacity-40" disabled={f.handle.length < 3 || !f.entity} onClick={claim}>Claim</button></div>
            </div>
          )}
        </Section>
      )}
      <Section title="Your Pay IDs">
        {rows.length === 0 ? <p className="text-[12px] text-mist">None yet.</p> : rows.map(r => (
          <div key={r.id} className="border-t border-ink/10 py-3 first:border-t-0 flex flex-wrap items-center gap-3">
            <strong className="text-[13px]">{r.address}</strong><Chip status={r.status === "ACTIVE" ? "APPROVED" : "DRAFT"} label={r.status.toLowerCase()} />
            <span className="text-[11px] text-mist">{r.holder}</span>
            <a className="text-gold hover:underline text-[11px]" href={`/id/${r.handle}`} target="_blank" rel="noopener noreferrer">Open page</a>
            {canWrite && <button className="ml-auto text-[10px] uppercase tracking-widest text-mist hover:text-ink" onClick={() => toggle(r.id, r.status)}>{r.status === "ACTIVE" ? "Switch off" : "Switch on"}</button>}
          </div>
        ))}
      </Section>
    </Shell>
  );
}
