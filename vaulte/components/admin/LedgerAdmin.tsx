"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";

const TABS: Array<[string, string]> = [["trial_balance", "Trial balance"], ["income_statement", "Income statement"], ["balance_sheet", "Balance sheet"], ["memo", "Customer funds (memo)"], ["journals", "Journals"], ["periods", "Periods"], ["recon", "Reconciliation"]];
const usd = (c: string | bigint | number) => (Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const minor = (v: string, ccy: string) => (Number(v) / (["JPY", "KRW"].includes(ccy) ? 1 : 100)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function LedgerAdmin() {
  const [tab, setTab] = useState("trial_balance");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [integrity, setIntegrity] = useState<any>(null);
  const [csv, setCsv] = useState({ partner: "", text: "" });
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setData(null); setErr("");
    const url = tab === "journals" ? "/api/admin/ledger/journals?limit=30" : tab === "periods" ? "/api/admin/ledger/periods" : tab === "recon" ? "/api/admin/recon?status=exceptions" : `/api/admin/ledger/reports?type=${tab}${tab === "income_statement" ? "&from=2000-01-01" : ""}`;
    const r = await api(url);
    if (r.ok) setData(r.data); else setErr(r.error?.message ?? "Failed");
  }, [tab]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api("/api/admin/ledger/verify").then(r => r.ok && setIntegrity(r.data)); }, []);

  async function close(id: string) { const r = await api("/api/admin/ledger/periods", { body: { period_id: id } }); if (!r.ok) setErr(r.error?.message ?? "Failed"); else load(); }
  async function importCsv() {
    setNote("");
    const r = await api("/api/admin/recon", { body: { partner: csv.partner, csv: csv.text } });
    if (!r.ok) return setErr(r.error?.message ?? "Failed");
    setNote(`Imported: ${r.data.matched} matched, ${r.data.mismatched} mismatched, ${r.data.unmatched} unmatched.`); load();
  }
  async function resolve(id: string) { const n = window.prompt("Explain how this exception was resolved (min 10 characters)"); if (!n) return; const r = await api(`/api/admin/recon/lines/${id}`, { body: { note: n } }); if (!r.ok) setErr(r.error?.message ?? "Failed"); else load(); }

  return (
    <Shell title="Ledger" back={{ href: "/admin", label: "Review queue" }}>
      {integrity && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate mb-6">
          <Chip status={integrity.chain.ok ? "APPROVED" : "REJECTED"} label={integrity.chain.ok ? `Chain verified (${integrity.chain.journals} journals)` : `Chain BROKEN: ${integrity.chain.reason}`} />
          <Chip status={integrity.database_guards_installed ? "APPROVED" : "REJECTED"} label={integrity.database_guards_installed ? "Database guards installed" : "Database guards missing"} />
        </div>
      )}
      <div className="flex gap-1 border-b border-ink/10 mb-6 overflow-x-auto">
        {TABS.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`px-4 py-3 text-[11px] uppercase tracking-widest whitespace-nowrap ${tab === id ? "text-ink border-b-2 border-gold" : "text-mist hover:text-ink"}`}>{label}</button>)}
      </div>
      {err && <ErrorBox message={err} />}
      {!data ? <p className="text-[11px] text-mist">Loading…</p> : (
        <>
          {tab === "trial_balance" && (
            <Section title="Trial balance" hint="Debits and credits by account and currency; USD columns are the base-currency view.">
              <a className="text-gold text-[11px] hover:underline" href="/api/admin/ledger/reports?type=trial_balance&format=csv">Download CSV</a>
              <table className="w-full text-[12px] mt-3"><thead><tr className="text-left text-[9px] uppercase tracking-widest text-mist"><th className="py-2">Account</th><th>Ccy</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">USD net</th></tr></thead>
                <tbody>{data.rows.map((r: any, i: number) => <tr key={i} className="border-t border-ink/10"><td className="py-2">{r.code} {r.name}{r.isMemo ? " (memo)" : ""}</td><td>{r.currency}</td><td className="text-right">{minor(r.debit, r.currency)}</td><td className="text-right">{minor(r.credit, r.currency)}</td><td className="text-right">{usd(r.baseNet)}</td></tr>)}
                  <tr className="border-t-2 border-ink/30 font-medium"><td className="py-2" colSpan={2}>Total (USD)</td><td className="text-right">{usd(data.totals.baseDebit)}</td><td className="text-right">{usd(data.totals.baseCredit)}</td><td className="text-right"><Chip status={data.totals.balanced ? "APPROVED" : "REJECTED"} label={data.totals.balanced ? "Balanced" : "OUT OF BALANCE"} /></td></tr></tbody></table>
            </Section>
          )}
          {tab === "income_statement" && (
            <Section title="Income statement (all time, USD)">
              {[["Revenue", data.revenue], ["Expenses", data.expenses]].map(([label, secs]: any) => <div key={label} className="mb-4"><div className="label-text">{label}</div>{secs.length === 0 ? <p className="text-[12px] text-mist">None</p> : secs.flatMap((s: any) => s.accounts.map((a: any) => <p key={a.code} className="flex justify-between text-[12px] py-1"><span>{a.code} {a.name}</span><span>{usd(a.baseUsdCents)}</span></p>))}</div>)}
              <p className="flex justify-between text-[13px] border-t border-ink/20 pt-3 font-medium"><span>Net income</span><span>{usd(data.netIncome)}</span></p>
            </Section>
          )}
          {tab === "balance_sheet" && (
            <Section title="Balance sheet (USD)" hint="Customer money held by partners is not included: it is not Vaulte's.">
              {[["Assets", data.assets], ["Liabilities", data.liabilities], ["Equity", data.equity]].map(([label, secs]: any) => <div key={label} className="mb-4"><div className="label-text">{label}</div>{secs.flatMap((s: any) => s.accounts.map((a: any) => <p key={a.code} className="flex justify-between text-[12px] py-1"><span>{a.code} {a.name}</span><span>{usd(a.baseUsdCents)}</span></p>))}</div>)}
              <p className="flex justify-between text-[12px] py-1"><span>Current earnings</span><span>{usd(data.currentEarnings)}</span></p>
              <p className="flex justify-between text-[13px] border-t border-ink/20 pt-3 font-medium"><span>Assets {usd(data.totalAssets)} · Liabilities + equity {usd(BigInt(data.totalLiabilities) + BigInt(data.totalEquity))}</span><Chip status={data.balanced ? "APPROVED" : "REJECTED"} label={data.balanced ? "Balanced" : "OUT OF BALANCE"} /></p>
            </Section>
          )}
          {tab === "memo" && (
            <Section title="Customer funds held by partners (memorandum)" hint={data.note}>
              <table className="w-full text-[12px]"><tbody>{data.rows.map((r: any, i: number) => <tr key={i} className="border-t border-ink/10"><td className="py-2">{r.code} {r.name}</td><td>{r.currency}</td><td className="text-right">{minor(r.net, r.currency)}</td></tr>)}</tbody></table>
            </Section>
          )}
          {tab === "journals" && data.data.map((j: any) => (
            <div key={j.id} className="border border-ink/10 p-4 mb-3 text-[12px]">
              <div className="flex flex-wrap gap-3 mb-2"><strong>#{j.seq}</strong><span>{j.kind}</span><span className="text-mist">{j.period} · {j.source}{j.transfer_id ? ` · transfer ${j.transfer_id.slice(-8)}` : ""}</span>{j.reversal_of && <Chip status="NEEDS_INFO" label="reversal" />}</div>
              {j.memo && <p className="text-mist mb-1">{j.memo}</p>}
              {j.lines.map((l: any, i: number) => <p key={i} className="flex justify-between"><span>{l.account} {l.name}</span><span>{Number(l.amount_minor) >= 0 ? "Dr" : "Cr"} {l.currency} {minor(String(Math.abs(Number(l.amount_minor))), l.currency)}</span></p>)}
              <p className="text-[10px] text-mist mt-1 font-mono truncate">hash {j.hash}</p>
            </div>
          ))}
          {tab === "periods" && (
            <Section title="Accounting periods" hint="Closing locks a finished month and stores a hashed trial-balance snapshot. There is no reopen: corrections go into an open period.">
              {data.data.map((p: any) => <div key={p.id} className="flex items-center gap-4 border-t border-ink/10 first:border-0 py-2 text-[12px]"><strong>{p.id}</strong><Chip status={p.status === "CLOSED" ? "APPROVED" : "IN_REVIEW"} label={p.status} />{p.snapshot_hash && <span className="text-mist font-mono text-[10px]">{p.snapshot_hash.slice(0, 16)}…</span>}{p.status === "OPEN" && new Date(p.ends_on) < new Date() && <button className="text-gold text-[10px] uppercase tracking-widest" onClick={() => close(p.id)}>Close period</button>}</div>)}
            </Section>
          )}
          {tab === "recon" && (
            <>
              <Section title="Import a partner statement" hint="CSV columns: direction (PAYOUT/FUNDING/FEE/OTHER), reference, currency, amount[, date, description]. References match the partner's transfer id or our transfer id.">
                <input className="input-field mb-3" placeholder="Partner id (e.g. airwallex)" value={csv.partner} onChange={e => setCsv({ ...csv, partner: e.target.value })} />
                <textarea className="input-field mb-3 font-mono" rows={5} placeholder={"direction,reference,currency,amount\nPAYOUT,stubtr-1,EUR,920.00"} value={csv.text} onChange={e => setCsv({ ...csv, text: e.target.value })} />
                <button className="btn-primary disabled:opacity-40" disabled={!csv.partner || !csv.text} onClick={importCsv}>Import and match</button>{note && <span className="ml-4 text-[12px] text-[#2D6A4F]">{note}</span>}
              </Section>
              <Section title="Exceptions">
                {data.data.length === 0 ? <p className="text-[12px] text-mist">No open exceptions.</p> : data.data.map((l: any) => <div key={l.id} className="flex flex-wrap items-center gap-3 border-t border-ink/10 first:border-0 py-2 text-[12px]"><Chip status={l.status === "AMOUNT_MISMATCH" ? "NEEDS_INFO" : "REJECTED"} label={l.status.replace("_", " ")} /><span>{l.partner} · {l.direction} · {l.reference}</span><span>{l.currency} {minor(l.amount_minor, l.currency)}{l.expected_minor ? ` (booked ${minor(l.expected_minor, l.currency)})` : ""}</span><span className="text-mist">{l.note}</span><button className="text-gold text-[10px] uppercase tracking-widest" onClick={() => resolve(l.id)}>Resolve</button></div>)}
              </Section>
            </>
          )}
        </>
      )}
    </Shell>
  );
}
