# Launch checklist

**Reading guide.** `BUILT` = implemented and tested in this repository. `YOU` = needs a decision, contract, key or person that code cannot supply.
`BLOCKER` = do not take real money until it is done. `node scripts/preflight.mjs` checks the technical items automatically; it cannot judge legal readiness.

## 1. Legal and regulatory (all BLOCKERS, all YOU)
| # | Item | Owner | Notes |
|---|------|-------|-------|
| L1 | Written legal opinion on Vaulte's own regulatory status in each launch jurisdiction (India, US, EU, UK, UAE, SG) for the model "technology platform routing through licensed partners, markup only, never holds funds" | Counsel | Whether routing instructions plus a markup makes Vaulte itself a regulated payment intermediary/aggregator/MTSS agent is a legal question. Code cannot answer it. |
| L2 | Signed agreements with licensed partners for each corridor: India inbound (PA-CB export / MTSS partner), India outward (AD bank / LRS), USD/EUR/GBP/AED/SGD funding and off-ramps, stablecoin on/off-ramp (MiCA-authorised for EU) | Business + Counsel | Real fees/limits go into `PARTNER_CATALOG_JSON` (see `docs/partners.example.json`). Until then **no live route exists** (fails closed). Each partner also needs an adapter in `lib/psp/stablecoin/registry.ts` (only Airwallex exists today). |
| L3 | India: FEMA/RBI review of the stablecoin legs (all offshore; Indian parties never hold or send crypto: enforced in `lib/guardrails`), VDA tax treatment for any Indian participant, purpose-code mapping, EDPMS/eBRC processes, PA-CB 25 lakh cap and MTSS USD 2,500 / 30-per-year limits (enforced) re-checked against current circulars | Counsel + CA | Limits in code are from public summaries (Oct 2026). Confirm before launch and on every RBI change. |
| L4 | Customer-money structure with Airwallex or any wallet-based partner: use connected accounts so customer funds are never in a Vaulte-owned balance | Counsel + Partner | See README (M4). |
| L5 | Terms, Privacy, AML policy, grievance page: replace the drafts, then set `LEGAL_REVIEWED=true` | Counsel | Drafts in `app/legal/*` are clearly marked. |
| L6 | Appoint compliance officer / MLRO, Grievance Officer, DPO (if required); board-approved AML/CFT programme and staff training record | Management | |
| L7 | Data protection: DPDP Act and GDPR assessment (records of processing, DPA with processors, breach procedure, cross-border transfer basis); RBI payment-data storage requirement if you become an authorised payment system operator or your partner requires it | Counsel + CTO | Set `DATA_REGION`; use an India-region S3 bucket and database for Indian payment data if required. |
| L8 | Marketing claims: no "licensed", "fastest", "cheapest", "compliant" or "no fees" claim unless you can substantiate it | Marketing + Counsel | The product pages avoid these; keep it that way. |

## 2. Providers and keys (YOU)
| Item | Status |
|------|--------|
| Airwallex sandbox smoke test: `node scripts/airwallex-smoke.mjs` with your sandbox keys, send the output so field names can be confirmed | **UNVERIFIED against the real service** (network blocked in the build environment) |
| Sandbox.co.in KYC keys + `node scripts/kyc-smoke.mjs` | **UNVERIFIED live** |
| QuickBooks / Zoho / Xero developer apps, sandbox company tests | **UNVERIFIED live** (stub-tested) |
| Tally: run `scripts/tally-bridge.mjs` against a real Tally and check the result | **UNVERIFIED** |
| Resend (or other) email domain with SPF/DKIM/DMARC; OTP emails delivered | YOU |
| Open Exchange Rates (or another licensed FX source) | YOU (production refuses to quote without it) |
| Chain-analytics wallet screening (Chainalysis/TRM/Elliptic) if you hold exposure to deposits; the free list check is not exposure scoring | YOU |
| EU consolidated sanctions list (needs registration) before serving EU-regulated activity | YOU |

## 3. Security (BLOCKERS unless noted)
| Item | Status |
|------|--------|
| Upgrade Next.js to 15/16 (14.2.35 is the last 14.x; remaining advisories are mitigated, see `scripts/audit-gate.mjs`) | **YOU / engineering: schedule before launch**; the async request APIs change touches `cookies()`/`headers()` usage |
| Independent penetration test and fix findings | YOU |
| Secrets in a secret manager, rotated; `ENCRYPTION_KEY` rotation procedure rehearsed (documents and identifiers are encrypted with it: **losing it loses the data**) | YOU |
| WAF / reverse proxy: request size limits, bot protection, TLS 1.2+, DDoS | YOU |
| Database: private network, TLS, least-privilege app role (owner needed once for `db-guards`), PITR backups tested (see `docs/OPERATIONS.md`) | YOU |
| Security headers, CSP, HSTS, CSRF guard, rate limits, OTP hardening, 2FA for staff, audit logs | BUILT |
| Bug-bounty / disclosure contact on `/legal/security` | YOU |

## 4. Product and operations (BUILT unless noted)
- Identity: email-OTP sign-up/login, TOTP, sessions, roles, invites, API keys. **BUILT**
- KYC/KYB: requirement matrix, provider adapter, documents, risk tiers, EDD four-eyes, review queue. **BUILT**; real identity proofing (video KYC/CKYC/DigiLocker) is the provider's/partner's job: **YOU**
- Sanctions: OFAC/UN/UK, fuzzy matching, wallet list screening, alert queue, daily rescreen. **BUILT** (cron required)
- Routing/FX: cheapest/fastest selection, firm quotes, failover, rails catalogue, live-mode separation from mock partners. **BUILT**; live catalogue **YOU**
- Ledger: double-entry multi-currency, DB-enforced immutability, periods, reports, reconciliation. **BUILT**; accounting policy (NET vs GROSS), tax, year-end **YOU**
- Documents/certificates, realisation packs. **BUILT**
- ERP exports and connectors, webhooks with replay. **BUILT** (vendor apps **YOU**)
- Staff runbooks, on-call, incident response, status page. **YOU** (starting points in `docs/OPERATIONS.md`)
- Cron jobs configured and alerting on failure (`docs/OPERATIONS.md`). **YOU**
- Load test on staging: `node scripts/load-smoke.mjs`. **YOU** run

## 5. Go-live sequence
1. Counsel sign-off (L1, L3, L5) and signed partner agreements (L2, L4).
2. Provision production (database, S3, secrets, domain, email); run `prisma migrate deploy`, `node scripts/db-guards.mjs`, `node scripts/sanctions-sync.mjs --force`.
3. Create the first staff accounts (`scripts/create-staff.mjs`), enable their two-factor, then **remove the shell access that created them**.
4. Load `PARTNER_CATALOG_JSON` for the first corridor only; run `node scripts/preflight.mjs`; fix every FAIL.
5. Pilot: a handful of verified customers with low limits; reconcile every transfer against the partner statement daily; review sanctions alerts and KYC queue SLAs.
6. Widen corridors and limits only after a clean reconciliation period.
