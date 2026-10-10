"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";
import { fmtMinor } from "@/lib/currency";

interface Entity { id: string; legalName: string; country: string; currency: string; verificationStatus: string }
const DETAIL_LABEL: Record<string, string> = { iban: "IBAN", sort_code: "Sort code", account_number: "Account number", routing_number: "Routing number", bsb: "BSB", institution_number: "Institution no.", transit_number: "Transit no.", swift_code: "SWIFT/BIC", account_holder: "Account holder" };

export default function VirtualAccountsClient({ role, entities }: { role: string; entities: Entity[] }) {
  const canWrite = ["OWNER", "ADMIN", "FINANCE"].includes(role);
  const approved = entities.filter(e => e.verificationStatus === "APPROVED");
  const [rows, setRows] = useState<any[]>([]); const [caps, setCaps] = useState<any>(null);
  const [open, setOpen] = useState<string>(""); const [credits, setCredits] = useState<any[]>([]);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [f, setF] = useState({ entity: approved[0]?.id ?? "", currency: "", country: "", sweep: "INR" });

  const load = useCallback(async () => {
    const [a, c] = await Promise.all([api("/api/virtual-accounts"), api("/api/virtual-accounts/capabilities")]);
    if (a.ok) setRows(a.data.data); if (c.ok) setCaps(c.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const opt = caps?.options?.find((o: any) => o.currency === f.currency);
  async function create() {
    setErr(""); setMsg("");
    const r = await api("/api/virtual-accounts", { body: { entity_id: f.entity, country: f.country, currency: f.currency, sweep_dest_currency: f.sweep } });
    if (!r.ok) return setErr(r.error?.message ?? "Could not open the account");
    setMsg(`${f.currency} account opened. Share the details below with whoever pays you.`); load();
  }
  async function show(id: string) { if (open === id) return setOpen(""); const r = await api(`/api/virtual-accounts/${id}`); if (r.ok) { setCredits(r.data.credits); setOpen(id); } }

  return (
    <Shell title="Virtual accounts" right={<a className="text-mist hover:text-ink" href="/dashboard">Dashboard</a>}>
      <p className="text-[12px] text-slate leading-relaxed max-w-2xl mb-6">Local bank details (IBAN, sort code, ACH, BSB…) issued by a licensed partner in your name, so payers can pay you like a local. Every credit is converted and paid out straight away. <strong>Vaulte keeps no balance</strong> and cannot hold your money.{caps?.mode === "test" ? " You are in test mode: these accounts are simulated." : ""}</p>
      {err && <ErrorBox message={err} />}{msg && <div className="border border-[#2D6A4F]/40 bg-[#2D6A4F]/5 px-4 py-3 text-[12px] mb-6">{msg}</div>}
      {canWrite && (
        <Section title="Open an account" hint={approved.length ? undefined : "Only verified accounts can open virtual accounts. Complete verification for an entity first."}>
          {approved.length > 0 && caps && (
            <div className="grid sm:grid-cols-4 gap-3 items-end">
              <div><label className="label-text">Account holder</label><select className="input-field" value={f.entity} onChange={e => setF({ ...f, entity: e.target.value })}>{approved.map(e => <option key={e.id} value={e.id}>{e.legalName} ({e.country})</option>)}</select></div>
              <div><label className="label-text">Currency</label><select className="input-field" value={f.currency} onChange={e => { const o = caps.options.find((x: any) => x.currency === e.target.value); setF({ ...f, currency: e.target.value, country: o?.countries?.[0] === "EU/EEA" ? "DE" : o?.countries?.[0] ?? "" }); }}><option value="">Select…</option>{caps.options.map((o: any) => <option key={o.currency + o.countries.join()} value={o.currency}>{o.currency} · {o.details_type.replace(/_/g, " ").toLowerCase()}</option>)}</select></div>
              <div><label className="label-text">Country</label><input className="input-field" value={f.country} onChange={e => setF({ ...f, country: e.target.value.toUpperCase().slice(0, 2) })} placeholder={opt ? opt.countries.join("/") : ""} /></div>
              <div><label className="label-text">Pay out as</label><input className="input-field" value={f.sweep} onChange={e => setF({ ...f, sweep: e.target.value.toUpperCase().slice(0, 3) })} /></div>
              <div className="sm:col-span-4"><button className="btn-primary disabled:opacity-40" disabled={!f.entity || !f.currency || f.country.length !== 2 || f.sweep.length !== 3} onClick={create}>Open account</button></div>
            </div>
          )}
        </Section>
      )}
      <Section title="Your accounts">
        {rows.length === 0 ? <p className="text-[12px] text-mist">None yet.</p> : rows.map(v => (
          <div key={v.id} className="border-t border-ink/10 py-4 first:border-t-0">
            <div className="flex flex-wrap items-center gap-3"><strong className="text-[13px]">{v.currency} · {v.holder}</strong><Chip status={v.status === "ACTIVE" ? "APPROVED" : "IN_REVIEW"} label={v.status} />{v.simulated && <span className="text-[10px] uppercase tracking-widest text-mist">simulated</span>}
              <span className="text-[11px] text-mist">pays out as {v.sweep_rule?.destCurrency}</span><button className="ml-auto text-gold hover:underline text-[11px]" onClick={() => show(v.id)}>{open === v.id ? "Hide credits" : "Credits"}</button></div>
            <dl className="grid sm:grid-cols-3 gap-x-6 gap-y-1 mt-3 text-[12px]">{Object.entries(v.account_details ?? {}).map(([k, val]) => <div key={k}><dt className="text-[9px] uppercase tracking-widest text-mist">{DETAIL_LABEL[k] ?? k}</dt><dd className="font-mono">{String(val)}</dd></div>)}</dl>
            {open === v.id && (credits.length === 0 ? <p className="text-[12px] text-mist mt-3">No credits yet.</p> : (
              <table className="w-full text-[12px] mt-3"><thead><tr className="text-left text-[9px] uppercase tracking-widest text-mist"><th className="py-1">Payer</th><th>Received</th><th>Paid out</th><th>Status</th><th>Time</th></tr></thead>
                <tbody>{credits.map(c => <tr key={c.transfer_id} className="border-t border-ink/10"><td className="py-1">{c.payer} ({c.payer_country})</td><td>{fmtMinor(c.received.amount, c.received.currency)}</td><td>{fmtMinor(c.paid_out.amount, c.paid_out.currency)}</td><td><Chip status={c.status === "COMPLETED" ? "APPROVED" : c.status === "FAILED" ? "REJECTED" : "IN_REVIEW"} label={c.status} />{c.status_reason && <div className="text-[10px] text-mist">{c.status_reason}</div>}</td><td>{c.seconds_to_complete != null ? `${c.seconds_to_complete} s` : "—"}</td></tr>)}</tbody></table>
            ))}
          </div>
        ))}
      </Section>
    </Shell>
  );
}
