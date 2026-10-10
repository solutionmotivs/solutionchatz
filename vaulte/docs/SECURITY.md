# Security notes

## Trust boundaries
Browser (customers, staff) -> Next.js app -> PostgreSQL / S3 / partners and vendors. Partners and vendors call back through signed webhooks. Cron jobs call internal endpoints with a shared secret.

## Controls in the code (and where)
- Authentication: bcrypt (cost 12), password policy and blocklist, email-verified accounts, hashed expiring OTPs, DB-backed rate limits and lockout, TOTP with replay guard and recovery codes, revocable server-side sessions, staff must use 2FA (`lib/auth*.ts`, `lib/otp.ts`, `lib/security/`).
- Authorisation: role checks per route; tenant isolation by `organizationId` in every query; staff-only routes via `requireStaff`.
- CSRF: same-origin guard in middleware and in handlers; SameSite session cookie; bearer-token calls are not ambient.
- Headers: CSP, HSTS, frame denial, nosniff, referrer, permissions, COOP/CORP (`next.config.mjs`); API responses `no-store`.
- Data protection: AES-256-GCM for documents, identifiers and tokens; masked display; encrypted S3 objects.
- Money safety: guardrails before any transfer; test and live catalogues never mix; firm quotes with TTL; idempotent partner events; failover and reversal; append-only hash-chained ledger enforced by the database.
- Input handling: zod validation, file type by content, size limits, SSRF guard for customer webhooks, HTML-escaped emails, XML/CSV escaping in exports.
- Supply chain: `npm audit` gate in CI with reviewed exceptions; lockfile committed.

## Known gaps (be honest in due diligence)
- Next.js 14.2.35 has unfixed 14.x advisories that are mitigated, not removed: upgrade to 15/16 before launch.
- No independent penetration test, no SOC 2/ISO 27001.
- `ENCRYPTION_KEY` rotation/re-encryption tooling is not built; key management relies on your secret manager.
- Customer webhook delivery depends on `assertPublicUrl` DNS checks at send time; a DNS-rebinding race is possible without egress filtering: run the app behind an egress proxy that blocks internal ranges.
- CSP allows `'unsafe-inline'` scripts/styles (Next.js prerendered pages); moving to nonces requires dynamic rendering of every page.
- Rate limits are per database row, not per edge: add a WAF/CDN for volumetric abuse.
- Staff actions are logged but there is no maker-checker on manual ledger journals or on manual verification overrides (the latter are disabled in production by default).
