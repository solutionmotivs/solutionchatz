"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (minor: string, ccy: string) => { const n = Number(minor) / (["JPY", "KRW"].includes(ccy) ? 1 : 100); return n.toLocaleString("en-US", { minimumFractionDigits: ["JPY", "KRW"].includes(ccy) ? 0 : 2, maximumFractionDigits: 2 }); };

export default function StatementClient() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [tab, setTab] = useState<"statement" | "settlements">("statement");
  const [data, setData] = useState<any>(null);
  const [settle, setSettle] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null); setErr("");
    api(`/api/statements?from=${from}&to=${to}T23:59:59Z`).then(r => (r.ok ? setData(r.data) : setErr(r.error?.message ?? "Failed")));
    api(`/api/settlements?from=${from}&to=${to}T23:59:59Z`).then(r => { if (r.ok) setSettle(r.data); });
  }, [from, to]);
  const base = tab === "statement" ? "statements" : "settlements";
  return (
    <Shell title="Statements and settlements">
      <p className="text-[12px] text-slate leading-relaxed max-w-2xl mb-6">Your transfers as recorded by Vaulte. Your money is held by licensed partners, not by Vaulte; this is a record, not a bank statement.</p>
      <div className="flex flex-wrap gap-4 items-end mb-6">
        <div><label className="label-text">From</label><input type="date" className="input-field" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className="label-text">To</label><input type="date" className="input-field" value={to} onChange={e => setTo(e.target.value)} /></div>
        {(["pdf", "xml", "csv"] as const).map(f => <a key={f} className="btn-ghost" href={`/api/${base}?from=${from}&to=${to}T23:59:59Z&format=${f}`}>Download {f.toUpperCase()}</a>)}
      </div>
      <div className="flex gap-2 mb-6">{(["statement", "settlements"] as const).map(t => <button key={t} className={t === tab ? "btn-primary" : "btn-ghost"} onClick={() => setTab(t)}>{t === "statement" ? "Account ledger" : "Settlements"}</button>)}</div>
      {err && <ErrorBox message={err} />}
      {tab === "settlements" ? (
        <Section title="Settlements" hint="Each transfer: what you sent, what the recipient received, the rate and fees, and which certificates are on file.">
          {!settle ? <p className="text-[11px] text-mist">Loading…</p> : settle.items.length === 0 ? <p className="text-[11px] text-mist">No transfers in this period.</p> : (
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-[9px] uppercase tracking-widest text-mist"><th className="py-2">Date</th><th>To</th><th className="text-right">Sent</th><th className="text-right">Recipient got</th><th className="text-right">Rate</th><th className="text-right">Fees USD</th><th>Status</th><th>Documents</th></tr></thead>
              <tbody>{settle.items.map((i: any) => (
                <tr key={i.reference} className="border-t border-ink/10">
                  <td className="py-2">{new Date(i.created_at).toLocaleDateString()}</td><td>{i.recipient} <span className="text-mist">({i.recipient_country})</span></td>
                  <td className="text-right">{i.source_currency} {i.source_amount}</td><td className="text-right">{i.dest_currency} {i.dest_amount}</td><td className="text-right">{i.effective_rate}</td><td className="text-right">{i.fees_usd}</td>
                  <td><Chip status={i.status === "COMPLETED" ? "APPROVED" : i.status === "FAILED" ? "REJECTED" : "IN_REVIEW"} label={i.status} /></td>
                  <td><a className="text-gold hover:underline" href={`/dashboard/transfers/${i.reference}`}>{i.documents_on_file || "open"}</a></td>
                </tr>))}</tbody>
            </table>
          )}
        </Section>
      ) : (
      <Section title="Activity">
        {!data ? <p className="text-[11px] text-mist">Loading…</p> : data.lines.length === 0 ? <p className="text-[11px] text-mist">No activity in this period.</p> : (
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[9px] uppercase tracking-widest text-mist"><th className="py-2">Date</th><th>Description</th><th>Transfer</th><th className="text-right">Received</th><th className="text-right">Fees / paid out</th><th className="text-right">Open after</th><th></th></tr></thead>
            <tbody>{data.lines.map((l: any, i: number) => (
              <tr key={i} className="border-t border-ink/10">
                <td className="py-2">{new Date(l.date).toLocaleDateString()}</td><td>{l.description}</td><td className="text-mist">{l.reference ? l.reference.slice(-8) : "—"}</td>
                <td className="text-right">{l.received !== "0" ? `${l.currency} ${fmt(l.received, l.currency)}` : ""}</td>
                <td className="text-right">{l.paid_out_or_fees !== "0" ? `${l.currency} ${fmt(l.paid_out_or_fees, l.currency)}` : ""}</td>
                <td className="text-right">{l.currency} {fmt(l.open_obligation_after, l.currency)}</td><td>{l.transfer_status && <Chip status={l.transfer_status === "COMPLETED" ? "APPROVED" : l.transfer_status === "FAILED" ? "REJECTED" : "IN_REVIEW"} label={l.transfer_status} />}</td>
              </tr>))}</tbody>
          </table>
        )}
      </Section>
      )}
    </Shell>
  );
}
