import Link from "next/link";
import { COMPANY, LEGAL_REVIEWED, unconfiguredFields } from "@/lib/legal";
import { TERMS_VERSION } from "@/lib/auth-flows";

export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  const missing = unconfiguredFields();
  return (
    <main className="min-h-screen bg-paper px-6 py-14 font-mono">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-[10px] uppercase tracking-widest text-mist hover:text-ink">← Vaulte</Link>
        {!LEGAL_REVIEWED && (
          <div className="border border-[#9A4B12]/40 bg-[#9A4B12]/5 px-4 py-3 text-[11px] text-ink leading-relaxed my-6">
            <strong>DRAFT FOR LEGAL REVIEW.</strong> This text is a starting point written by an engineering team. It is not legal advice and has not been reviewed by counsel. Do not launch until qualified lawyers in every jurisdiction you serve have reviewed and adopted it, then set LEGAL_REVIEWED=true.
            {missing.length > 0 && <div className="mt-2">Company details still to fill in: {missing.join(", ")}.</div>}
          </div>
        )}
        <h1 className="font-serif text-4xl text-ink mt-4 mb-2">{title}</h1>
        <p className="text-[10px] uppercase tracking-widest text-mist mb-8">Version {TERMS_VERSION} · {COMPANY.name}</p>
        <div className="legal-body text-[12px] text-slate leading-[1.9] space-y-4">{children}</div>
        <nav className="mt-12 pt-6 border-t border-ink/10 flex flex-wrap gap-6 text-[10px] uppercase tracking-widest text-mist">
          <Link href="/legal/terms" className="hover:text-ink">Terms</Link><Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/legal/aml" className="hover:text-ink">AML policy</Link><Link href="/legal/security" className="hover:text-ink">Security</Link><Link href="/legal/grievance" className="hover:text-ink">Grievance officer</Link>
        </nav>
      </div>
    </main>
  );
}

export const H = ({ children }: { children: React.ReactNode }) => <h2 className="font-serif text-xl text-ink pt-4">{children}</h2>;
