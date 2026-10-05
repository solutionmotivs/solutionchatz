"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";

interface Entity { id: string; legalName: string; country: string; currency: string }
interface Line { description: string; quantity: string; unit_price: string; tax_rate: string }
const blank = (): Line => ({ description: "", quantity: "1", unit_price: "", tax_rate: "0" });
const major = (minor: number, ccy: string) => (minor / (["JPY", "KRW"].includes(ccy) ? 1 : 100)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toMinor = (v: string, ccy: string) => Math.round(Number(v || 0) * (["JPY", "KRW"].includes(ccy) ? 1 : 100));
const CHIP: Record<string, string> = { PAID: "APPROVED", SENT: "IN_REVIEW", DRAFT: "DRAFT", CANCELLED: "REJECTED", OVERDUE: "NEEDS_INFO", PARTIALLY_PAID: "IN_REVIEW" };

export default function InvoicesClient({ role, entities }: { role: string; entities: Entity[] }) {
  const canWrite = ["OWNER", "ADMIN", "FINANCE"].includes(role);
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [kind, setKind] = useState<"INVOICE" | "PROFORMA">("INVOICE");
  const [f, setF] = useState({ currency: entities[0]?.currency ?? "USD", issuer: entities[0]?.id ?? "", payer_name: "", payer_email: "", payer_address: "", payer_tax_id: "", reference: "", due_date: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { const r = await api("/api/invoices?per_page=50"); if (r.ok) setRows(r.data.data); }, []);
  useEffect(() => { load(); }, [load]);

  const total = lines.reduce((s, l) => { const net = Math.round(Number(l.quantity || 0) * toMinor(l.unit_price, f.currency)); return s + net + Math.round(net * Number(l.tax_rate || 0) / 100); }, 0);

  async function create(send: boolean) {
    setErr(""); setMsg(""); setBusy(true);
    const body: any = {
      kind, currency: f.currency, ...(f.issuer ? { issuer_entity_id: f.issuer } : {}),
      line_items: lines.filter(l => l.description).map(l => ({ description: l.description, quantity: Number(l.quantity), unit_price: toMinor(l.unit_price, f.currency), tax_rate: Number(l.tax_rate || 0) })),
    };
    for (const [k, v] of Object.entries({ payer_name: f.payer_name, payer_email: f.payer_email, payer_address: f.payer_address, payer_tax_id: f.payer_tax_id, reference: f.reference, due_date: f.due_date, notes: f.notes })) if (v) body[k] = v;
    const r = await api("/api/invoices", { body });
    if (!r.ok) { setBusy(false); return setErr(r.error?.message ?? "Could not create"); }
    if (send) {
      if (!f.payer_email) { setBusy(false); setErr("Add the payer's email to send it."); await load(); return; }
      const s = await api(`/api/invoices/${r.data.id}/send`, { body: { recipientEmail: f.payer_email, recipientName: f.payer_name || f.payer_email } });
      setMsg(s.ok ? `${r.data.number} created and emailed.` : `${r.data.number} created, but sending failed: ${s.error?.message}`);
    } else setMsg(`${r.data.number} created. Copy its pay link below or download the PDF.`);
    setLines([blank()]); setBusy(false); load();
  }
  async function act(id: string, path: string) { setErr(""); const r = await api(`/api/invoices/${id}/${path}`, { body: {} }); if (!r.ok) setErr(r.error?.message ?? "Failed"); else load(); }
  async function copy(url: string) { try { await navigator.clipboard.writeText(url); setMsg("Pay link copied."); } catch { setMsg(url); } }

  return (
    <Shell title="Invoices and payment links" right={<a className="text-mist hover:text-ink" href="/dashboard">Dashboard</a>}>
      <p className="text-[12px] text-slate leading-relaxed max-w-2xl mb-6">Create invoices or proforma invoices, send them by email, or share a pay link. Payers pay through our licensed partners; Vaulte never holds the money. Tax details are yours to set and are printed as you enter them.</p>
      {err && <ErrorBox message={err} />}{msg && <div className="border border-[#2D6A4F]/40 bg-[#2D6A4F]/5 px-4 py-3 text-[12px] mb-6">{msg}</div>}

      {canWrite && (
        <Section title="New document">
          <div className="flex gap-2 mb-4">{(["INVOICE", "PROFORMA"] as const).map(k => <button key={k} className={k === kind ? "btn-primary" : "btn-ghost"} onClick={() => setKind(k)}>{k === "INVOICE" ? "Invoice" : "Proforma invoice"}</button>)}</div>
          <div className="grid sm:grid-cols-3 gap-4">
            {entities.length > 1 && <div><label className="label-text">Get paid as</label><select className="input-field" value={f.issuer} onChange={e => setF({ ...f, issuer: e.target.value })}>{entities.map(e => <option key={e.id} value={e.id}>{e.legalName} ({e.country})</option>)}</select></div>}
            <div><label className="label-text">Currency</label><input className="input-field" maxLength={3} value={f.currency} onChange={e => setF({ ...f, currency: e.target.value.toUpperCase() })} /></div>
            <div><label className="label-text">Due date</label><input className="input-field" type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} /></div>
            <div><label className="label-text">Payer name</label><input className="input-field" value={f.payer_name} onChange={e => setF({ ...f, payer_name: e.target.value })} /></div>
            <div><label className="label-text">Payer email</label><input className="input-field" type="email" value={f.payer_email} onChange={e => setF({ ...f, payer_email: e.target.value })} /></div>
            <div><label className="label-text">Payer tax ID (optional)</label><input className="input-field" value={f.payer_tax_id} onChange={e => setF({ ...f, payer_tax_id: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className="label-text">Payer address</label><input className="input-field" value={f.payer_address} onChange={e => setF({ ...f, payer_address: e.target.value })} /></div>
            <div><label className="label-text">PO / reference</label><input className="input-field" value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} /></div>
          </div>
          <div className="mt-5">
            <div className="grid grid-cols-[1fr_70px_110px_70px_30px] gap-2 text-[9px] uppercase tracking-widest text-mist mb-1"><span>Description</span><span>Qty</span><span>Unit price</span><span>Tax %</span><span /></div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_70px_110px_70px_30px] gap-2 mb-2">
                <input className="input-field" aria-label={`Description ${i + 1}`} value={l.description} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                <input className="input-field" aria-label={`Quantity ${i + 1}`} type="number" min="0" step="any" value={l.quantity} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                <input className="input-field" aria-label={`Unit price ${i + 1}`} type="number" min="0" step="0.01" value={l.unit_price} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x))} />
                <input className="input-field" aria-label={`Tax ${i + 1}`} type="number" min="0" max="100" step="any" value={l.tax_rate} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, tax_rate: e.target.value } : x))} />
                {lines.length > 1 && <button className="text-[#9B2C2C]" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line">×</button>}
              </div>
            ))}
            <button className="text-gold text-[11px] hover:underline" onClick={() => setLines([...lines, blank()])}>+ Add line</button>
          </div>
          <div className="mt-4"><label className="label-text">Notes (printed on the document)</label><textarea className="input-field" rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="font-serif text-xl">{f.currency} {major(total, f.currency)}</span>
            <button className="btn-primary disabled:opacity-40" disabled={busy || total <= 0} onClick={() => create(false)}>Create</button>
            <button className="btn-ghost disabled:opacity-40" disabled={busy || total <= 0 || !f.payer_email} onClick={() => create(true)}>Create and email</button>
          </div>
        </Section>
      )}

      <Section title="Your documents">
        {rows.length === 0 ? <p className="text-[11px] text-mist">Nothing yet.</p> : (
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[9px] uppercase tracking-widest text-mist"><th className="py-2">Number</th><th>Type</th><th>Payer</th><th className="text-right">Total</th><th>Status</th><th></th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id} className="border-t border-ink/10">
                <td className="py-2">{r.number}</td><td>{r.kind === "PROFORMA" ? "Proforma" : "Invoice"}</td><td>{r.payer_name ?? r.payer_email ?? "—"}</td>
                <td className="text-right">{r.currency} {major(r.total_amount, r.currency)}</td><td><Chip status={CHIP[r.status] ?? "DRAFT"} label={r.status} /></td>
                <td className="text-right whitespace-nowrap space-x-3">
                  <a className="text-gold hover:underline" href={`/api/invoices/${r.id}/pdf`}>PDF</a>
                  <button className="text-gold hover:underline" onClick={() => copy(r.pay_url)}>Copy link</button>
                  {canWrite && r.kind === "PROFORMA" && r.status !== "CANCELLED" && r.status !== "PAID" && <button className="text-gold hover:underline" onClick={() => act(r.id, "convert")}>Convert</button>}
                  {canWrite && !["PAID", "CANCELLED"].includes(r.status) && <button className="text-[#9B2C2C] hover:underline" onClick={() => act(r.id, "cancel")}>Cancel</button>}
                </td>
              </tr>))}</tbody>
          </table>
        )}
      </Section>
    </Shell>
  );
}
