"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { COUNTRIES } from "@/lib/countries";
import { CURRENCIES, fmtMinor } from "@/lib/currency";
import { ErrorBox } from "@/components/auth/AuthShell";

const CCY = Object.values(CURRENCIES).map(c => c.code);
const HOME: Record<string, string> = { IN: "INR", US: "USD", GB: "GBP", AE: "AED", SG: "SGD", CA: "CAD", AU: "AUD", JP: "JPY", HK: "HKD", CN: "CNH", SA: "SAR", NZ: "NZD", CH: "CHF" };
const homeCcy = (cc: string) => HOME[cc] ?? (["DE", "FR", "NL", "IE", "ES", "IT", "PT", "BE", "AT", "FI", "LU", "GR", "EE", "LV", "LT", "HR", "CY", "MT", "SK", "SI"].includes(cc) ? "EUR" : "USD");
const dur = (s: number) => (s < 90 ? `${Math.round(s)} seconds` : s < 5400 ? `${Math.round(s / 60)} minutes` : `${Math.round(s / 360) / 10} hours`);
const usd = (n: number) => `$${n.toFixed(2)}`;
const legName = (l: { partner: string; kind: string; rails: string[] }) => `${l.partner.startsWith("mock_") ? "Simulated " : ""}${l.partner.replace(/^mock_/, "").toUpperCase()} · ${l.rails.join("/")}`;

interface Option {
  label: string; prefer: string;
  route: { partners: string[]; token: string | null; chain: string | null; legs: { partner: string; kind: string; rails: string[]; country: string }[] };
  you_send: { currency: string; amount_minor: number }; they_receive: { currency: string; amount_minor: number };
  effective_rate: number; mid_market_rate: number; cost_vs_mid_bps: number;
  fees: { partner_cost_usd: number; vaulte_fee_usd: number; vaulte_fee_bps: number; total_usd: number; total_bps: number; collection_note: string };
  bank_wire_estimate_usd: number; saves_vs_bank_usd: number;
  timing: { basis: "measured" | "target"; same_day: boolean; within_24h: boolean; waits_for_banking_hours: boolean; effective_seconds: number; note: string };
  fx_compared: { provider: string; rate: number; spread_bps: number; chosen: boolean }[] | null;
}
interface Estimate { mode: "test" | "live"; options: Option[]; certificate: string | null; disclaimer: string }
interface Row { from: string; to: string; mode: string; samples: number; p50_seconds: number; p90_seconds: number; same_day_pct: number | null }

export default function QuotePage() {
  const [f, setF] = useState({ from_country: "US", to_country: "IN", from_currency: "USD", to_currency: "INR", amount: "5000", kind: "BUSINESS", funding: "FIAT_LOCAL" });
  const [res, setRes] = useState<Estimate | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState<Row[]>([]);
  useEffect(() => { api("/api/public/scoreboard").then(r => r.ok && setBoard(r.data?.corridors ?? [])); }, []);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  async function go() {
    setErr(""); setBusy(true); setRes(null);
    const r = await api("/api/public/quote", { body: { ...f, amount: Number(f.amount), token: f.funding === "STABLECOIN" ? "USDC" : undefined } });
    setBusy(false);
    if (!r.ok) return setErr(r.error?.message ?? "Could not estimate");
    setRes(r.data as Estimate);
  }
  const amt = Number(f.amount);
  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <Link href="/" className="font-serif text-xl text-ink">Vaulte</Link>
        <div className="section-tag mt-8">Compare</div>
        <h1 className="font-serif text-4xl text-ink mb-3">What will it cost, and when does it land?</h1>
        <p className="font-mono text-xs text-mist leading-relaxed mb-6">Every fee on one screen, from the cheapest route, the fastest route and the one that lands today. No account needed. This is an <strong>estimate</strong>: real prices come from our licensed partners and show on a real quote. Vaulte does not hold your money; the licensed partner does.</p>

        <div className="grid sm:grid-cols-4 gap-3 items-end mb-4">
          <div><label className="label-text">From</label><select className="input-field" value={f.from_country} onChange={e => setF(p => ({ ...p, from_country: e.target.value, from_currency: homeCcy(e.target.value) }))}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
          <div><label className="label-text">Send in</label><select className="input-field" value={f.from_currency} onChange={e => set("from_currency", e.target.value)}>{CCY.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label-text">To</label><select className="input-field" value={f.to_country} onChange={e => setF(p => ({ ...p, to_country: e.target.value, to_currency: homeCcy(e.target.value) }))}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
          <div><label className="label-text">They receive in</label><select className="input-field" value={f.to_currency} onChange={e => set("to_currency", e.target.value)}>{CCY.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label-text">Amount ({f.from_currency})</label><input className="input-field" inputMode="decimal" value={f.amount} onChange={e => set("amount", e.target.value.replace(/[^0-9.]/g, ""))} /></div>
          <div><label className="label-text">Type</label><select className="input-field" value={f.kind} onChange={e => set("kind", e.target.value)}><option value="BUSINESS">Business</option><option value="PERSONAL">Personal</option></select></div>
          <div><label className="label-text">You pay with</label><select className="input-field" value={f.funding} onChange={e => setF(p => ({ ...p, funding: e.target.value, from_currency: e.target.value === "STABLECOIN" && !["USD", "EUR"].includes(p.from_currency) ? "USD" : p.from_currency }))}><option value="FIAT_LOCAL">Bank transfer</option><option value="STABLECOIN">USDC (stablecoin)</option></select></div>
          <div><button className="btn-primary w-full disabled:opacity-40" disabled={busy || !(amt > 0)} onClick={go}>{busy ? "Comparing…" : "Compare"}</button></div>
        </div>
        <ErrorBox message={err} />

        {res && (
          <div className="mt-6 space-y-4">
            <div className="font-mono text-[11px] tracking-wider text-gold uppercase">{res.mode === "test" ? "Test-mode estimate · simulated partners" : "Estimate from live partner quotes"}</div>
            {res.options.map((o, i) => (
              <div key={o.prefer} className={`border px-5 py-4 ${i === 0 ? "border-gold bg-white" : "border-ink/15 bg-white/60"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-serif text-xl text-ink">{o.label}{i === 0 && <span className="ml-2 font-mono text-[10px] tracking-widest text-gold">RECOMMENDED</span>}</div>
                  <div className="font-mono text-xs text-slate">{o.timing.same_day ? "Lands today" : o.timing.within_24h ? "Within 24 hours" : "More than 24 hours"} · {o.timing.basis === "measured" ? "measured" : "target"} {dur(o.timing.effective_seconds)}{o.timing.waits_for_banking_hours ? " (includes bank hours)" : ""}</div>
                </div>
                <div className="mt-3 grid sm:grid-cols-3 gap-4 text-[13px]">
                  <div><div className="label-text">They receive</div><div className="font-serif text-2xl text-ink">{fmtMinor(o.they_receive.amount_minor, o.they_receive.currency)}</div><div className="font-mono text-[11px] text-mist">rate {o.effective_rate} · mid-market {o.mid_market_rate}</div></div>
                  <div><div className="label-text">All-in cost</div><div className="font-serif text-2xl text-ink">{usd(o.fees.total_usd)} <span className="text-sm text-mist">({(o.fees.total_bps / 100).toFixed(2)}%)</span></div><div className="font-mono text-[11px] text-mist">partner {usd(o.fees.partner_cost_usd)} + Vaulte {usd(o.fees.vaulte_fee_usd)} ({(o.fees.vaulte_fee_bps / 100).toFixed(2)}%)</div></div>
                  <div><div className="label-text">Versus a typical bank wire</div><div className="font-serif text-2xl text-ink">{o.saves_vs_bank_usd > 0 ? `Save ${usd(o.saves_vs_bank_usd)}` : "No saving"}</div><div className="font-mono text-[11px] text-mist">bank estimate {usd(o.bank_wire_estimate_usd)}</div></div>
                </div>
                <div className="mt-3 font-mono text-[11px] text-slate">Route: {o.route.legs.map(legName).join("  →  ")}{o.route.token ? ` · ${o.route.token} on ${o.route.chain}` : ""}</div>
                {o.fx_compared && o.fx_compared.length > 1 && <div className="mt-1 font-mono text-[11px] text-mist">FX compared: {o.fx_compared.map(c => `${c.provider.replace(/^mock_/, "")} ${c.spread_bps} bps${c.chosen ? " ✓" : ""}`).join(" · ")}</div>}
                <div className="mt-2 font-mono text-[11px] text-mist">{o.timing.note}</div>
              </div>
            ))}
            {res.certificate && <div className="border border-ink/15 bg-white/60 px-5 py-3 text-[12px] text-slate">{res.certificate}</div>}
            <p className="font-mono text-[11px] text-mist leading-relaxed">{res.disclaimer} {res.options[0]?.fees.collection_note}</p>
            <div className="flex gap-3"><Link href="/pilot" className="btn-primary">Join the pilot</Link><Link href="/register" className="btn-ghost">Open a test-mode account</Link></div>
          </div>
        )}

        <div className="mt-12">
          <div className="section-tag">Measured, not promised</div>
          <h2 className="font-serif text-2xl text-ink mb-2">Settlement scoreboard</h2>
          {board.length === 0 ? (
            <p className="font-mono text-xs text-mist leading-relaxed">A corridor appears here after enough completed transfers have been measured (at least 5 in the last 30 days). Until then we show targets, labelled as targets.</p>
          ) : (
            <table className="w-full text-[12px] font-mono">
              <thead><tr className="text-left text-mist"><th className="py-1">Corridor</th><th>Mode</th><th>Transfers</th><th>Half arrive within</th><th>9 in 10 within</th><th>Same day</th></tr></thead>
              <tbody>{board.map(r => <tr key={`${r.from}${r.to}${r.mode}`} className="border-t border-ink/10"><td className="py-1">{r.from} → {r.to}</td><td>{r.mode}</td><td>{r.samples}</td><td>{dur(r.p50_seconds)}</td><td>{dur(r.p90_seconds)}</td><td>{r.same_day_pct ?? "–"}%</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
