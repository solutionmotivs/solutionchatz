"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message ?? "Login failed");
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper flex">
      {/* Left — branding */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] bg-ink p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-radial from-gold/10 to-transparent" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-8 h-8 bg-paper rounded-[4px] flex items-center justify-center">
              <span className="text-ink font-bold text-sm">V</span>
            </div>
            <span className="font-serif text-xl text-paper">Vaulte</span>
          </div>
          <h2 className="font-serif text-4xl text-paper leading-tight mb-6">
            The settlement layer<br />
            for <em className="text-gold">global business</em>.
          </h2>
          <p className="font-mono text-xs text-white/40 leading-relaxed">
            USDC · USDT · SEPA · Faster Payments · FedNow · IMPS<br />
            Payments executed by licensed partners
          </p>
        </div>
        <p className="relative z-10 font-mono text-[9px] text-white/25">Vaulte is a technology platform and does not hold customer funds.</p>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[400px]">
          <div className="lg:hidden flex items-center gap-3 mb-12">
            <span className="font-serif text-2xl text-ink">Vaulte</span>
          </div>

          <div className="mb-10">
            <div className="section-tag">Secure Sign In</div>
            <h1 className="font-serif text-4xl text-ink mb-2">Welcome back.</h1>
            <p className="font-mono text-xs text-mist">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="text-gold hover:underline">Register your business</Link>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="label-text">Work Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input-field"
                placeholder="cfo@acmecorp.com"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label-text">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input-field"
                placeholder="••••••••••"
                required
              />
            </div>

            {error && (
              <div className="font-mono text-xs text-v-red border border-v-red/25 bg-v-red/5 px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full disabled:opacity-60"
            >
              {loading ? "Authenticating..." : "Sign In →"}
            </button>
          </form>

          <p className="mt-8 font-mono text-[9px] text-mist leading-relaxed">
            By signing in, you agree to Vaulte&apos;s Terms of Service and AML Policy.
            This platform is for business entities only.
          </p>
        </div>
      </div>
    </div>
  );
}
