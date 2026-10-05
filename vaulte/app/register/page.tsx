// app/register/page.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const COUNTRIES = [
  ["IN","India"],["US","United States"],["GB","United Kingdom"],
  ["SG","Singapore"],["DE","Germany"],["AE","UAE"],["AU","Australia"],
  ["CA","Canada"],["NL","Netherlands"],["FR","France"],["JP","Japan"],
];

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "", email: "", password: "", company_name: "", country: "IN",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState("");

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message ?? "Registration failed");
        return;
      }

      setApiKey(data.test_api_key);
      setTimeout(() => router.push("/onboarding"), 2000);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (apiKey) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-8">
        <div className="max-w-[480px] w-full">
          <div className="text-v-green-light text-3xl mb-6">✓</div>
          <h1 className="font-serif text-4xl text-ink mb-3">Account created.</h1>
          <p className="font-mono text-xs text-mist mb-8">Redirecting to your dashboard…</p>
          <div className="border border-v-green/25 bg-v-green/5 p-5">
            <div className="font-mono text-[9px] uppercase tracking-widest text-v-green mb-3">Your Test API Key</div>
            <code className="font-mono text-xs text-gold break-all block">{apiKey}</code>
            <p className="font-mono text-[9px] text-mist mt-3 leading-relaxed">
              Store this securely. Complete KYB in your dashboard to enable live payments.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper flex">
      <div className="hidden lg:flex flex-col justify-between w-[380px] bg-ink p-12">
        <div>
          <Link href="/" className="flex items-center gap-3 mb-16">
            <div className="w-7 h-7 bg-paper rounded-[3px] flex items-center justify-center">
              <span className="text-ink font-bold text-xs">V</span>
            </div>
            <span className="font-serif text-xl text-paper">Vaulte</span>
          </Link>
          <h2 className="font-serif text-3xl text-paper leading-snug mb-6">
            Start in the <em className="text-gold">sandbox</em><br/>today.
          </h2>
          <ul className="space-y-4 font-mono text-[11px] text-white/40 leading-relaxed">
            {[
              "Test mode available immediately",
              "Verification is done by our licensed partners",
              "Live payments unlock after verification",
              "USDC, USDT and local bank routes — one API",
              "Vaulte never holds your funds",
            ].map(item => (
              <li key={item} className="flex gap-3">
                <span className="text-gold">—</span>{item}
              </li>
            ))}
          </ul>
        </div>
        <p className="font-mono text-[9px] text-white/25 leading-relaxed">Vaulte is a technology platform. Payments are provided by licensed partners.</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-8">
            <div className="section-tag">Business Registration</div>
            <h1 className="font-serif text-4xl text-ink mb-2">Create your account.</h1>
            <p className="font-mono text-xs text-mist">
              Already have an account?{" "}
              <Link href="/login" className="text-gold hover:underline">Sign in</Link>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label-text">Full Name</label>
                <input className="input-field" placeholder="Rahul Sharma" value={form.name}
                  onChange={e => update("name", e.target.value)} required />
              </div>
              <div className="col-span-2">
                <label className="label-text">Work Email</label>
                <input type="email" className="input-field" placeholder="rahul@company.com" value={form.email}
                  onChange={e => update("email", e.target.value)} required />
              </div>
              <div className="col-span-2">
                <label className="label-text">Password</label>
                <input type="password" className="input-field" placeholder="Min. 10 characters" value={form.password}
                  onChange={e => update("password", e.target.value)} required minLength={10} />
              </div>
              <div className="col-span-2">
                <label className="label-text">Company Legal Name</label>
                <input className="input-field" placeholder="Acme Technologies Pvt. Ltd." value={form.company_name}
                  onChange={e => update("company_name", e.target.value)} required />
              </div>
              <div className="col-span-2">
                <label className="label-text">Country of Incorporation</label>
                <select className="input-field appearance-none" value={form.country}
                  onChange={e => update("country", e.target.value)}>
                  {COUNTRIES.map(([code, name]) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </select>
              </div>
            </div>

            {error && (
              <div className="font-mono text-xs text-v-red border border-v-red/25 bg-v-red/5 px-4 py-3">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60 mt-2">
              {loading ? "Creating Account..." : "Create Account →"}
            </button>
          </form>

          <p className="mt-6 font-mono text-[9px] text-mist leading-relaxed">
            By registering, you confirm this is a business entity and agree to complete KYB verification.
            B2B use only. Consumer payments not supported.
          </p>
        </div>
      </div>
    </div>
  );
}
