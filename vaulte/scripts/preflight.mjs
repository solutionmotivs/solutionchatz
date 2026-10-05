// Pre-launch gate. Run with the PRODUCTION environment variables loaded and BASE_URL pointing at the deployed app:
//   set -a; . ./prod.env; set +a; BASE_URL=https://app.example.com node scripts/preflight.mjs
// Exits non-zero if anything that must be true before real money moves is not. It cannot judge legal readiness: see docs/LAUNCH.md.
const env = process.env;
const results = [];
const check = (area, name, ok, detail = "", blocker = true) => results.push({ area, name, ok, detail, blocker });

// Secrets and switches
for (const [k, min] of [["JWT_SECRET", 32], ["OTP_PEPPER", 32], ["ENCRYPTION_KEY", 32], ["CRON_SECRET", 24], ["DATABASE_URL", 10], ["NEXT_PUBLIC_APP_URL", 8]]) check("config", `${k} set`, (env[k]?.length ?? 0) >= min, `need >= ${min} characters`);
check("config", "NODE_ENV=production", env.NODE_ENV === "production");
check("config", "AUTH_EXPOSE_DEV_OTP off", env.AUTH_EXPOSE_DEV_OTP !== "true");
check("config", "app URL is https", /^https:\/\//.test(env.NEXT_PUBLIC_APP_URL ?? ""));
check("config", "no weak/default secrets", ![env.JWT_SECRET, env.OTP_PEPPER, env.ENCRYPTION_KEY].some(s => /dev-only|changeme|example|0123456789abcdef/.test(s ?? "")));
check("config", "ADMIN override disabled", env.ALLOW_MANUAL_VERIFY_OVERRIDE !== "true", "ALLOW_MANUAL_VERIFY_OVERRIDE must not be true in production");
check("email", "email provider key", !!env.RESEND_API_KEY && !!env.EMAIL_FROM, "RESEND_API_KEY and EMAIL_FROM");
check("storage", "S3 bucket for documents (India region for Indian payment data)", !!env.S3_BUCKET && !!env.S3_ACCESS_KEY_ID && !!env.S3_SECRET_ACCESS_KEY);
check("fx", "live FX rate source", !!env.OPENEXCHANGERATES_APP_ID);
check("kyc", "a real KYC provider (not the mock)", env.KYC_PROVIDER === "sandbox_co_in" && !!env.SANDBOX_CO_IN_API_KEY && env.SANDBOX_CO_IN_ENV === "live", "KYC_PROVIDER=sandbox_co_in, live keys", false);
check("partners", "live partner catalogue configured", !!(env.PARTNER_CATALOG_JSON || env.PARTNER_CATALOG_FILE), "without it no live route exists (fails closed)");
check("partners", "Airwallex in live mode with a connected-account id", env.AIRWALLEX_ENV === "live" && !!env.AIRWALLEX_ON_BEHALF_OF && !!env.AIRWALLEX_WEBHOOK_SECRET, "needed only if Airwallex is used; connected accounts keep customer funds out of a Vaulte-owned wallet", false);
check("legal", "company and grievance details set", ["COMPANY_LEGAL_NAME", "COMPANY_ADDRESS", "GRIEVANCE_OFFICER_NAME", "GRIEVANCE_OFFICER_EMAIL", "SUPPORT_EMAIL", "DATA_REGION", "GOVERNING_LAW"].every(k => !!env[k]));
check("legal", "legal texts approved by counsel (LEGAL_REVIEWED=true)", env.LEGAL_REVIEWED === "true", "set only after real legal review");

// The running deployment
const base = (env.BASE_URL ?? "").replace(/\/$/, "");
if (!base) check("deployment", "BASE_URL provided", false, "set BASE_URL to test the live site");
else {
  const get = async (p, init) => { try { const r = await fetch(base + p, { redirect: "manual", ...init }); return r; } catch (e) { return null; } };
  const health = await get("/api/health"); check("deployment", "liveness", health?.status === 200);
  const ready = await get("/api/health/ready"); const rj = ready ? await ready.json().catch(() => ({})) : {};
  check("deployment", "readiness (database, ledger guards, sanctions lists, secrets)", ready?.status === 200, JSON.stringify((rj.checks ?? []).filter(c => !c.ok)));
  const home = await get("/");
  const h = n => home?.headers.get(n) ?? "";
  check("headers", "HSTS", /max-age=\d{7,}/.test(h("strict-transport-security")));
  check("headers", "CSP with frame-ancestors none", /frame-ancestors 'none'/.test(h("content-security-policy")));
  check("headers", "nosniff + no framing", h("x-content-type-options") === "nosniff" && h("x-frame-options") === "DENY");
  check("headers", "no X-Powered-By", !h("x-powered-by"));
  const cross = await get("/api/entities", { method: "POST", headers: { Origin: "https://evil.example", Cookie: "vaulte_session=x", "Content-Type": "application/json" }, body: "{}" });
  check("security", "cross-site cookie request blocked", cross?.status === 403);
  check("security", "admin API needs auth", (await get("/api/admin/verification"))?.status === 401);
  check("security", "cron endpoints need the secret", (await get("/api/internal/sanctions/sync", { method: "POST" }))?.status === 401);
  check("security", "dev OTP not exposed", !JSON.stringify(await (await get("/api/auth/resend-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "nobody@example.com" }) }))?.json().catch(() => ({}))).includes("dev_code"));
  check("deployment", "legal pages served", (await get("/legal/terms"))?.status === 200 && (await get("/legal/privacy"))?.status === 200 && (await get("/legal/grievance"))?.status === 200);
  check("deployment", "TLS (https)", base.startsWith("https://"));
}

const w = Math.max(...results.map(r => r.name.length));
let blockers = 0, warns = 0;
for (const r of results) {
  const tag = r.ok ? "PASS" : r.blocker ? "FAIL" : "WARN";
  console.log(`${tag}  [${r.area}] ${r.name.padEnd(w)} ${r.ok ? "" : r.detail}`);
  if (!r.ok) r.blocker ? blockers++ : warns++;
}
console.log(`\n${blockers} blocker(s), ${warns} warning(s). Passing this script does NOT mean you are legally cleared to operate: see docs/LAUNCH.md.`);
process.exit(blockers ? 1 : 0);
