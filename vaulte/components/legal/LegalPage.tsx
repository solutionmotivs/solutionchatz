import Link from "next/link";
import { COMPANY, LEGAL_EFFECTIVE_DATE, LEGAL_REVIEWED, unconfiguredFields } from "@/lib/legal";
import { TERMS_VERSION } from "@/lib/auth-flows";

const NAV: Array<[string, string]> = [
  ["/legal/terms", "Terms"], ["/legal/privacy", "Privacy"], ["/legal/cookies", "Cookies"], ["/legal/data-requests", "Your data rights"],
  ["/legal/aml", "AML policy"], ["/legal/acceptable-use", "Acceptable use"], ["/legal/disclosures", "Fees & risks"],
  ["/legal/sandbox", "Test mode"], ["/legal/security", "Security"], ["/legal/grievance", "Grievance officer"],
];

export default function LegalPage({ title, children, subtitle }: { title: string; children: React.ReactNode; subtitle?: string }) {
  const missing = unconfiguredFields();
  return (
    <main className="min-h-screen bg-paper px-6 py-14 font-mono">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-[10px] uppercase tracking-widest text-mist hover:text-ink">← Vaulte</Link>
        {missing.length > 0 && (
          <div role="alert" className="border border-[#9A4B12]/40 bg-[#9A4B12]/5 px-4 py-3 text-[11px] text-ink leading-relaxed my-6">
            <strong>Operator action needed.</strong> These company details are not configured, so this page shows a placeholder: {missing.join(", ")}.
          </div>
        )}
        <h1 className="font-serif text-4xl text-ink mt-4 mb-2">{title}</h1>
        {subtitle && <p className="text-[12px] text-slate mb-2">{subtitle}</p>}
        <p className="text-[10px] uppercase tracking-widest text-mist mb-8">{`Version ${TERMS_VERSION} · Effective ${LEGAL_EFFECTIVE_DATE} · ${COMPANY.name}${LEGAL_REVIEWED ? " · Reviewed by counsel" : ""}`}</p>
        <div className="legal-body text-[12px] text-slate leading-[1.9] space-y-4">{children}</div>
        <nav aria-label="Legal pages" className="mt-12 pt-6 border-t border-ink/10 flex flex-wrap gap-x-6 gap-y-3 text-[10px] uppercase tracking-widest text-mist">
          {NAV.map(([href, label]) => <Link key={href} href={href} className="hover:text-ink">{label}</Link>)}
        </nav>
      </div>
    </main>
  );
}

export const H = ({ children, id }: { children: React.ReactNode; id?: string }) => <h2 id={id} className="font-serif text-xl text-ink pt-4">{children}</h2>;
export const H3 = ({ children }: { children: React.ReactNode }) => <h3 className="font-serif text-base text-ink pt-2">{children}</h3>;
export const A = ({ href, children }: { href: string; children: React.ReactNode }) => <a className="text-gold underline" href={href}>{children}</a>;
export const Table = ({ head, rows }: { head: string[]; rows: string[][] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-[11px] border border-ink/10">
      <thead className="bg-ink/5"><tr>{head.map(h => <th key={h} className="px-3 py-2 font-semibold text-ink align-top">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-ink/10">{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
);
