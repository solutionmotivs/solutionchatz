import Link from "next/link";

export default function AuthShell({ tag, title, subtitle, children }: { tag: string; title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper flex">
      <div className="hidden lg:flex flex-col justify-between w-[400px] bg-ink p-12 relative overflow-hidden">
        <div className="relative z-10">
          <Link href="/" className="flex items-center gap-3 mb-16">
            <div className="w-8 h-8 bg-paper rounded-[4px] flex items-center justify-center"><span className="text-ink font-bold text-sm">V</span></div>
            <span className="font-serif text-xl text-paper">Vaulte</span>
          </Link>
          <h2 className="font-serif text-4xl text-paper leading-tight mb-6">
            Cross-border payments,<br /><em className="text-gold">through licensed partners</em>.
          </h2>
          <ul className="space-y-3 font-mono text-[11px] text-white/45 leading-relaxed">
            {["Email-verified accounts with optional two-factor", "Business (KYB) and individual (KYC) verification", "USDC, USDT and local bank routes, one quote", "Vaulte never holds your funds"].map(t => (
              <li key={t} className="flex gap-3"><span className="text-gold">—</span>{t}</li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 font-mono text-[9px] text-white/25">Vaulte is a technology platform. Payments are provided by licensed partners.</p>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[440px]">
          <div className="mb-8">
            <div className="section-tag">{tag}</div>
            <h1 className="font-serif text-4xl text-ink mb-2">{title}</h1>
            {subtitle && <p className="font-mono text-xs text-mist">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return <div className="font-mono text-xs text-v-red border border-v-red/25 bg-v-red/5 px-4 py-3" role="alert">{message}</div>;
}

export function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value} autoFocus
      onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className="input-field text-center text-2xl tracking-[0.5em]" placeholder="••••••" aria-label="6-digit code"
    />
  );
}
