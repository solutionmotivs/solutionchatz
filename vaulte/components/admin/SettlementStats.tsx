"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Section, Shell } from "@/components/verification/shared";

const dur = (s: number | null) => (s == null ? "—" : s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

export default function SettlementStats() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState("");
  useEffect(() => { api("/api/admin/settlement-stats").then(r => (r.ok ? setD(r.data) : setErr(r.error?.message ?? "Failed"))); }, []);
  return (
    <Shell title="Settlement times">
      <ErrorBox message={err} />
      <Section title="Measured per corridor" hint={`Funds confirmed by the partner to payout completed, last ${d?.window_days ?? 30} days. A time is shown to customers as "measured" only with at least ${d?.min_samples_to_publish ?? 5} completed transfers; otherwise they see a target. Sandbox rows are simulated.`}>
        {!d ? "Loading…" : d.corridors.length === 0 ? <p className="text-[12px] text-mist">No completed transfers yet.</p> : (
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[9px] uppercase tracking-widest text-mist"><th className="py-2">Corridor</th><th>Mode</th><th>Transfers</th><th>Median</th><th>90th percentile</th><th>Same calendar day</th></tr></thead>
            <tbody>{d.corridors.map((c: any) => (
              <tr key={`${c.origin}${c.dest}${c.sandbox}`} className="border-t border-ink/10"><td className="py-2">{c.origin} → {c.dest}</td><td>{c.sandbox ? "Test" : "Live"}</td><td>{c.samples}</td><td>{dur(c.p50_seconds)}</td><td>{dur(c.p90_seconds)}</td><td>{c.same_day_pct}%</td></tr>))}</tbody>
          </table>
        )}
      </Section>
    </Shell>
  );
}
