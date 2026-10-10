import LegalPage, { H } from "@/components/legal/LegalPage";

export const dynamic = "force-dynamic";

export default function Security() {
  return (
    <LegalPage title="Security overview">
      <H>How we protect your account and data</H>
      <p>Passwords are hashed with bcrypt and checked against common-password lists. Sign-in uses email-verified accounts, one-time codes that are hashed, expire in ten minutes and are attempt-limited, and optional authenticator-app two-factor (mandatory for staff). Sessions are server-side and revocable; accounts lock after repeated failures. API keys are shown once and stored hashed.</p>
      <p>Identity documents and verification numbers are encrypted before storage. Webhooks and partner messages are signed and checked for replay. Our ledger is append-only: the database itself refuses edits and unbalanced entries, and journals are hash-chained so tampering is detectable. Staff access to documents is logged.</p>
      <p>The application sends strict security headers (content-security policy, HSTS, no framing), blocks cross-site state-changing requests, and rate-limits sensitive endpoints.</p>
      <H>Reporting a vulnerability</H>
      <p>Email the address on our <a className="text-gold underline" href="/legal/grievance">contact page</a> with details and steps to reproduce. Please do not access other customers&apos; data or disrupt the service while testing. We will acknowledge reports and keep you informed.</p>
      <H>What we have not claimed</H>
      <p>No third-party security certification (such as SOC 2 or ISO 27001) or independent penetration test is claimed by this text; if and when those are completed they will be stated here with their dates.</p>
    </LegalPage>
  );
}
