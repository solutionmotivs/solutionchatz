# Vaulte

Cross-border payments orchestration: pay and get paid in **USDC / USDT or local bank rails**, routed through **licensed partners**.
Vaulte is a technology layer. **It never holds customer funds**: partners receive, convert, hold and pay out.

> Status: **sandbox / pre-launch.** All partners are mocks. Nothing here moves real money. Read "Before real money" below.

## What it does
- **Quotes** (`POST /api/quotes`): picks the cheapest/fastest route across partners (with failover alternates), prices it with a
  volume-tiered markup and a margin floor, and returns an itemised, time-limited quote.
- **Transfers** (`POST /api/stablecoin/payins`): create a transfer from a quote. The partner issues a one-time deposit address
  (stablecoin) or bank details (fiat). Partner webhooks drive the lifecycle: funds -> payout -> completed (or failover/failed).
- **Virtual accounts** (`POST /api/virtual-accounts`): partner-issued local receiving details per customer per country.
  Every credit is **auto-swept** (converted and paid out); no balance is kept. Indian residents: collection-only, sweep to INR.
- **Public pay link** (`/pay/[token]`): payer chooses USDC/USDT, gets partner deposit instructions, status updates live.
- **Guardrails in code** (`lib/guardrails`): India origin = fiat only; India destination = INR to a bank, never crypto; invoice + RBI
  purpose code for India business payments; Rs 25 lakh PA-CB cap; personal inbound (MTSS) USD 2,500 per transfer and 30 per
  calendar year; LRS USD 250,000 per financial year + purpose + PAN verified; sanctions; verified parties.
- **Token rules** (`lib/routing`): USDT is never used on EU-licensed legs (MiCA); USDC works everywhere.
- **Memo ledger** (`lib/ledger`): double-entry in USD cents; per-transfer journals always net to zero; failures reverse.
- **Customer webhooks** (`lib/webhooks`): HMAC-signed (`X-Vaulte-Signature: t=...,v1=...`), retried with backoff, SSRF-guarded.

## Layout
```
app/api/quotes, stablecoin/payins, virtual-accounts, pay/[token], webhooks/partner/[partner], sandbox/partner/simulate,
        admin/{kyb,entities,transfers}, internal/webhooks/run     (new)
app/api/payments, invoices, kyb, entities, auth, ...             (original single-partner flow, kept)
lib/stablecoin   service (orchestration), rates, types, public-view
lib/routing      partner catalog (MOCK numbers) + route engine
lib/pricing      markup tiers, margin floor, itemised breakdown
lib/guardrails   legal-lane rules
lib/ledger       memo ledger
lib/psp/stablecoin  partner contract, mock partner, registry (real adapters plug in here)
tests/           vitest unit tests;  scripts/e2e.mjs  end-to-end run against a live server + Postgres
```

## Run locally
```bash
npm install
cp .env.example .env.local        # fill DATABASE_URL, JWT_SECRET, OTP_PEPPER, ENCRYPTION_KEY, CRON_SECRET
npx prisma generate && npx prisma db push
npm run dev
```
Tests: `npm test` (unit) and, with the server running, `node scripts/e2e.mjs` (needs `DATABASE_URL`, `CRON_SECRET`, `MOCK_PARTNER_WEBHOOK_SECRET`, `BASE_URL`; start the server with `AUTH_EXPOSE_DEV_OTP=true` so the script can read emailed codes; run against `next dev` so loopback webhooks are allowed).

Sandbox walk-through: register -> verify the emailed code -> create entities -> staff approves via `POST /api/admin/entities/verify` (staff session with two-factor) -> `POST /api/quotes` -> `POST /api/stablecoin/payins`
-> `POST /api/sandbox/partner/simulate` (`deposit.confirmed`, then `payout.completed`) -> check `GET /api/stablecoin/payins/:id`.

## Before real money (not done; do not skip)
1. **Legal opinion** (India + your entity's country): does arranging crypto-to-fiat conversion make you a VDA service provider (PMLA/FIU-IND)?
   Which agreement type with partners? FEMA treatment of stablecoin-funded personal remittances? GST/income tax on your markup?
2. **Signed partner agreements** with licensed partners (offshore ramps; RBI PA-CB for business into India; MTSS agent for personal inbound;
   AD bank / authorised outward provider for India -> abroad). Replace `lib/routing/catalog.ts` mock numbers with real firm quotes and
   implement real adapters behind `lib/psp/stablecoin/partner.ts`.
3. **Real KYB/KYC and sanctions screening** via partners (wallet screening hook: `lib/compliance/wallet.ts`; name screening: `COMPLYADVANTAGE_API_KEY`).
4. **Staff tooling**: `/api/admin/*` is protected by one shared token. Replace with staff accounts, roles and an audit trail.
5. Replace per-instance rate limiting (`lib/security/ratelimit.ts`) with a shared store; add monitoring, backups, secrets management.
6. Limits in `lib/guardrails` come from public summaries (Oct 2026). Confirm every number with counsel and the partners.

`DEPLOY.md` has deployment notes.

## Identity and access (M1)
- Sign-up needs an emailed 6-digit code (HMAC-hashed, 10 min, 5 attempts). Sign-in by password or emailed code; optional TOTP two-factor with single-use recovery codes; sessions are server-side and revocable; accounts lock for 15 min after 5 failed passwords; rate limits are stored in the database.
- Staff accounts (`isStaff`) must enable two-factor before any `/api/admin/*` route works. Create the first one with `node scripts/create-staff.mjs <email> <name>` and change the temporary password at first sign-in. `CRON_SECRET` is only for the cron endpoint.
- Production needs `RESEND_API_KEY` (no email is faked in production), `OTP_PEPPER` and a 32-byte hex `ENCRYPTION_KEY`. `AUTH_EXPOSE_DEV_OTP` is ignored in production.
- The legal pages under `/legal/*` are placeholders and must be replaced with counsel-approved text before launch.

## KYC / KYB (M2)
- Requirement matrix per region and purpose: `lib/kyc/requirements.ts` (India business: PAN, CIN/LLPIN, GSTIN, IEC, bank account, 10% beneficial owners, signatory; US: EIN, W-9; EU/UK/other: registry number, IBAN, 25% owners; individuals: ID, address, PAN for India, proof of funds for LRS). It is a product matrix, not legal advice, and partners may ask for more.
- Flow: customer fills profile, identifiers (format + checksum validated, then checked by a provider where one supports it), people, documents -> submit runs name screening + risk scoring -> staff review queue at `/admin` -> approval sets the due-diligence tier (SDD/CDD/EDD) which sets transfer limits (enforced in `lib/guardrails`). EDD needs two different approvers; sanctions or prohibited-jurisdiction hits cannot be approved.
- Providers: `KYC_PROVIDER=mock` (dev only), `sandbox_co_in` (PAN, GSTIN, bank penny-drop; written from their public API reference, stub-tested only). Run `node scripts/kyc-smoke.mjs` with your keys to verify it live. Without a provider every identifier goes to manual staff review.
- Documents are encrypted (AES-256-GCM) before they reach disk or S3, typed by content (PDF/PNG/JPEG, 8 MB), and every staff view is audit-logged. Aadhaar numbers are never collected.
- Old shortcut routes `/api/admin/entities/verify` and `/api/admin/kyb/approve` still exist for sandbox use but are disabled in production unless `ALLOW_MANUAL_VERIFY_OVERRIDE=true`.
- Not done by code: actual identity proofing (video KYC, CKYC, DigiLocker, Aadhaar eKYC) needs a licensed provider/partner; sanctions screening here still uses the M1-era local stub until M3.

## Sanctions screening (M3)
- Official lists mirrored into Postgres by `POST /api/internal/sanctions/sync` (cron, daily; `node scripts/sanctions-sync.mjs --force --rescreen` to run now): OFAC SDN (+aliases, addresses, digital-currency addresses), UN consolidated, UK sanctions list. The EU consolidated list needs a registered token and is not included: add it before relying on this for EU-regulated activity. Verified against the live downloads: about 19.5k OFAC, 1k UN and 6.4k UK entries, 505 listed wallet addresses.
- Matching (`lib/sanctions/match.ts`): diacritic/transliteration folding, token-order-insensitive, legal-suffix-insensitive, typo tolerant, birth-year aware. Policy: wallet hits and entity-name matches block; a person's name alone only goes to staff review unless the birth year also matches. One-word names are never fuzzy-matched. On the real lists, ordinary Indian business and personal names come back clear; very common names that really appear on lists (e.g. "Mohammed Ali") go to review, which is intended.
- Hooks: party creation (confirmed match refused with a neutral message), KYC/KYB submission (subject and every listed person), every transfer (both parties re-screened), sender wallet at deposit, virtual-account payers, and the daily re-screen of all customers and approved-case people. A party under review cannot be used in a quote or transfer until staff clear the alert; a confirmed match blocks them.
- Staff console: `/admin/sanctions` (alerts, dispositions with mandatory reasons, ad-hoc name/wallet check, list freshness). In production, if no list is loaded screening fails closed (everything goes to review).
- Optional second wallet source: set `CHAINALYSIS_API_KEY` (their free sanctions API). This is list screening, not blockchain-exposure scoring (mixers, indirect links): that needs a chain-analytics provider, typically run by the partner.
- Not code: deciding to freeze funds, filing blocking/suspicious-activity reports and regulator communication stay with your compliance officer and counsel.

## FX aggregation, Airwallex and rails (M4)
- **How "best rate" works**: for a corridor with no India leg and no stablecoin funding, every enabled FX provider returns a firm quote (Airwallex via its quotes API; sandbox desks in development). Each quote becomes a routable leg priced as `spread vs mid-market + fees`; the route engine then ranks it against the stablecoin routes and picks the cheapest landed cost (or fastest). The winning quote id is locked into the payout. The quote response shows every provider compared, the mid-market rate and the rail (`breakdown.fx`). A slow or failing provider is skipped, never fatal.
- **Airwallex** (`lib/psp/airwallex`): auth with token cache and refresh, FX quotes, beneficiaries, transfers (LOCAL or SWIFT, rate locked with `quote_id`, deterministic `request_id` so retries are safe), global accounts for funding, HMAC-signed webhooks with a 5-minute replay window (`/api/webhooks/partner/airwallex`). Contract-tested against `scripts/airwallex-stub.mjs` and exercised end to end through the app with it (192 e2e checks). **Not verified against the real Airwallex sandbox from here (network blocked): run `node scripts/airwallex-smoke.mjs` with your sandbox keys and send me the output.** Field names I was unsure of (conversion path, webhook event names) are isolated and overridable.
- **Currencycloud and Wise** (`lib/psp/currencycloud`, `lib/psp/wise`, M9): same contract as Airwallex. FX quotes feed the aggregator (Wise is compared net of its fee on the BALANCE option); payouts create the beneficiary/recipient, fix the BUY side so the recipient gets exactly the quoted amount (rate drift is Vaulte's margin), then pay; webhooks are normalised to `payout.completed|failed` (Currencycloud: secret in the callback URL, Wise: RSA-SHA256 `X-Signature-SHA256` with the public key you configure). Each provider is used only when its `*_ENV` matches the test/live mode. Contract-tested against local stubs (14 tests); **not verified against the real APIs from here**: run `node scripts/partner-smoke.mjs currencycloud|wise` with your own keys (read-only: auth + quotes). Add a payout partner to the live catalogue with `docs/partners.example.json` (partner ids `currencycloud`, `wise`).
- **Custody caution**: Airwallex pays from a wallet balance. If Vaulte funds one Vaulte-owned wallet with customer money, Vaulte holds customer funds in transit. Use Airwallex connected accounts (`AIRWALLEX_ON_BEHALF_OF`, needs a platform agreement) or another structure your counsel approves.
- **India** is deliberately excluded from general FX providers: INR in or out stays on RBI-authorised legs (PA-CB / MTSS / AD bank). Airwallex has no INR account and is not a PA-CB.
- **Rails** (`lib/routing/rails.ts`): SWIFT, SEPA / SEPA Instant, ACH / same-day ACH, FedNow, Fedwire, Faster Payments, FAST, NPP, HK FPS, Zengin, UAEFTS/Aani, IMPS/UPI/RTGS. Local rail is preferred where the currency and bank country allow it, otherwise SWIFT. Vaulte reaches these only through partners; times shown are typical, not guarantees.
- Production never quotes from a hard-coded rate table: set `OPENEXCHANGERATES_APP_ID` (or no quote is given).
- Recipient bank details must exist (`BankAccount`) before a real-partner payout; the sandbox mock ignores them.

## Accounting (M5)
- **General ledger** (`lib/ledger`): double-entry, multi-currency. Every journal balances in USD (base) **and** in each currency (FX goes through clearing lines, as in `tests/ledger.test.ts`). Debits positive, credits negative.
- **Chart of accounts** (`lib/ledger/chart.ts`): type (asset/liability/equity/revenue/expense), normal balance, reporting class, memo flag. Accounts 9100/9200 are **memorandum** accounts for customer money held by partners: reported separately, never on Vaulte's balance sheet.
- **Immutability is enforced by the database**, not only by code: triggers block UPDATE/DELETE on journals and entries, require all lines of a journal to be inserted in one statement that balances, and refuse postings into closed periods. Journals are also hash-chained (`GET /api/admin/ledger/verify` recomputes the chain). Corrections are reversing journals. Install the triggers once with `node scripts/db-guards.mjs` (development installs them automatically; production refuses to post without them unless `LEDGER_GUARDS_AUTOINSTALL=true`).
- **Transfers book themselves**: funds received, fees taken, payout (memo), and the markup earned (real). Default basis is NET/agent (only the markup is revenue); `ACCOUNTING_BASIS=GROSS` books all fees as revenue with partner cost as expense. Which is right is an accounting-policy question for your auditor.
- **Reports** (`/admin/ledger`, `GET /api/admin/ledger/reports`, CSV): trial balance, income statement, balance sheet (checks A = L + E), memo schedule, general ledger with running balance. **Periods**: monthly, close-only-after-end, in order, with a hashed snapshot; no reopen. **Manual journals**: staff only, reason required, memo accounts blocked, idempotency key, USD value from the rate table with rounding absorbed per currency.
- **Customer statements**: `/dashboard/statements` and `GET /api/statements` (session or API key, CSV). Records of transfers, explicitly not a bank statement.
- **Reconciliation**: import a partner statement (JSON or CSV), auto-match to transfers by reference and amount, exceptions queue with mandatory-explanation resolution, and a "completed but missing from the statement" check. Nothing is auto-corrected.
- Not built (needs your accountant/jurisdiction): tax computation (GST/TDS/VAT), year-end closing entries, revaluation of foreign-currency balances, multi-entity consolidation, maker-checker approval on large manual journals.
- The old single-currency memo ledger tables were replaced; there is no migration of old rows (sandbox data only).

## Documents and certificates (M6)
- **Who issues what**: eFIRA/FIRC (inward remittance advice) come from the authorised-dealer bank or licensed partner; eBRC is generated by the bank on the DGFT portal after realisation; shipping bills come from customs. **Vaulte never issues these**: it stores, links, checks and packages them.
- **Ingestion**: (1) the partner's eFIRA reference on payout completion is recorded automatically; (2) a signed partner event `document.issued` can deliver a certificate (reference and optional base64 PDF) straight to a transfer; (3) customers or API clients upload PDFs/images (`POST /api/documents`, or the transfer page) and staff verify them (`/admin/documents`). Files are encrypted before storage, judged by content (not filename), never overwritten once verified.
- **Checklist** (`GET /api/transfers/:id/documents`, shown on `/dashboard/transfers/:id`): Indian business receipts need purpose code, invoice and an eFIRA after the payout; goods exports (P01xx) also need a shipping bill and an eBRC; outward personal remittances need a purpose code. Rules live in `lib/documents/types.ts` and are a product default for your compliance officer to confirm.
- **Generated PDFs**: one-page payment advice and a full realisation pack (advice, timeline, checklist, document index with hashes, ledger extract, and every attached certificate merged in after Vaulte's own pages). Every Vaulte-generated page states that it is **not** a bank certificate, carries a data fingerprint, and each pack generation is audit-logged.
- Webhooks `document.received` / `document.verified`; ERP access with an API key (`/api/documents`, `/api/transfers/:id/pack`).
- Retention: records are append-only in spirit (no delete route). Set the retention period with counsel (commonly 5-8 years for AML and tax records).

## ERP, Tally, QuickBooks and webhooks (M7)
- **What gets booked**: for each completed transfer, one balanced voucher in the customer's own books (bank, counterparty clearing account, charges), in the transfer's cash currency (`lib/erp/vouchers.ts`). Money arriving in the account's country is a receipt, otherwise a payment (override with `perspective=`). Only transfers in the accounting currency are pushed to an ERP; others are skipped and available in the CSV/JSON exports.
- **Tally** has no webhooks or REST API: it takes XML over HTTP on port 9000 from the machine that runs it. Vaulte exports importable voucher XML (`/api/exports/tally`, creates missing ledgers under Sundry Debtors/Creditors and Indirect Expenses), and `scripts/tally-bridge.mjs` runs next to Tally, imports pending vouchers and acknowledges them (`/api/exports/ack`). Written from Tally's XML import format; **not tested against a real Tally** (no Tally here).
- **QuickBooks Online, Zoho Books, Xero**: OAuth2 connect from `/dashboard/integrations` (signed, expiring, user-bound state; tokens encrypted at rest; automatic refresh), one journal per transfer using accounts you map (ids for QuickBooks/Zoho, codes for Xero), idempotent (QuickBooks `requestid`, Xero `Idempotency-Key`, local sync records), failures recorded and retried, `erp.sync_failed` / `erp.sync_completed` events. A 15-minute cron (`POST /api/internal/erp/sync`) pushes new transfers. **Contract-tested against local stubs of each vendor (`scripts/erp-stub.mjs`), not against the real services**: you must register a developer app with each vendor (client id/secret, redirect URI `https://YOUR_HOST/api/integrations/<provider>/callback`, env vars in `.env.example`) and confirm with your sandbox company. Use a clearing account that is not an A/R or A/P control account (QuickBooks requires a contact on those).
- **Webhooks**: public catalogue at `/api/events/catalogue`; signed (`X-Vaulte-Signature`), stable event ids, 5 attempts with backoff, then dead-lettered and replayable from the dashboard or `POST /api/webhooks/events/:id/replay`. Ledger postings reach your endpoint through a **transactional outbox** (`ledger.journal.posted`, customer-facing memo lines only).
- **Exports**: `/api/exports/transfers|vouchers|invoices` (CSV/JSON, session or API key).
- Not built: pulling data back from ERPs (payments reconciliation, contact/vendor sync), per-line tax codes, multi-currency journals into ERPs, bank-feed integrations.

## Launch hardening (M8)
- **Test mode vs live mode never mix**: an account that is not KYB-approved gets the mock catalogue and sandbox FX desks only; an approved account gets only `PARTNER_CATALOG_JSON` (contracted partners, see `docs/partners.example.json`) and live providers. With no catalogue configured there is **no live route** (fails closed). A quote issued in test mode cannot become a live transfer (`assertRouteMode`).
- **Platform**: security headers and CSP (`next.config.mjs`), global CSRF guard and request ids (`middleware.ts`), structured JSON logs with redaction (`lib/log.ts`), `/api/health` and `/api/health/ready`, Next.js 14.2.35 (the last 14.x; the remaining advisories are reviewed and mitigated in `scripts/audit-gate.mjs`: **upgrade to Next 15/16 before launch**).
- **Policies**: Terms, Privacy (DPDP + GDPR), AML, Security and Grievance Officer pages are **drafts for counsel**, show a banner until `LEGAL_REVIEWED=true`, and read company details from `COMPANY_*` / `GRIEVANCE_*` env vars.
- **CI** (`.github/workflows/ci.yml`): typecheck, unit tests, build, audit gate, and the full e2e suite against Postgres with the Airwallex and ERP stubs.
- **Before going live**: `node scripts/preflight.mjs` (secrets, headers, readiness, provider settings), `node scripts/load-smoke.mjs` on staging, and work through `docs/LAUNCH.md` (legal and partner blockers), `docs/OPERATIONS.md` (jobs, backups, runbooks) and `docs/SECURITY.md` (controls and known gaps).

## Country packs and official registries (M10)
- **What is asked per country** (`lib/kyc/countries.ts`, `requirementsFor`): India (PAN, CIN/LLPIN, GSTIN, IEC, bank), US (EIN, W-9), UK (Companies House number, VAT), EU 27 (registry number, VAT ID, LEI), Australia (ABN, ACN), UAE (trade licence, TRN), Saudi Arabia (CR number, VAT, National Address), Malaysia (SSM number), Nepal (PAN/VAT, OCR registration), and a generic pack for everywhere else. Local entity types, documents and regulator notes come with each pack. Identifier formats and checksums (ABN, ACN, IBAN, GSTIN, EU VAT per state, ...) are checked before any lookup, so typos cost nothing.
- **Official lookups** (`lib/kyc/registries`): EU VIES and GLEIF (no key; **verified live from this environment**: a French VAT number and Apple's LEI returned their registered names), UK Companies House and Australian ABN Lookup (free keys, contract-tested against stubs), India GSTIN through the configured KYC provider. The registered legal name/address fills blank profile fields; a name that differs from what the applicant typed goes to staff review rather than being rejected, and a registry that is down never rejects anyone.
- **Cost control**: a malformed identifier never reaches a registry, answers are cached for 24 hours (misses for 10 minutes), each organisation is capped at 60 lookups per hour, and free official sources are used wherever they exist.
- **Honest limits**: India's RBIH/CKYC, DigiLocker, MCA and GSTN data are reachable only through registered requesters or licensed intermediaries, so the India path goes via the provider adapter (`KYC_PROVIDER`), not a direct government API. UAE, Saudi, Malaysia, Nepal and US registries have no open lookup API wired here: those identifiers are format-checked and go to staff, with the official portal link shown. Individuals upload ID documents; we do not collect national ID numbers.

## Invoices, proforma, payment links and checkout (M12)
- **Documents**: invoice and proforma (own number series `INV-`/`PF-`, sequential per year), per-line tax with a tax summary, payer address/tax ID, PO reference, purpose code, notes, PDF download (`/api/invoices/:id/pdf`, and for the payer `/api/pay/:token/pdf`). A proforma is labelled "not a tax invoice" and converts to a numbered invoice (`/convert`), which closes the proforma. Tax particulars are printed exactly as the issuer enters them; the PDF makes no claim about their correctness or about GST/VAT/export treatment.
- **Ways to get paid**: email (existing send flow), shareable link (`POST /api/payment-links`, can email it), hosted checkout for shops (`POST /api/checkout/sessions` with an API key; success/cancel URLs must be https; fulfil from the `invoice.paid` webhook, which now carries `number`, `reference`, `source`), a copy-paste button (`/vaulte-pay.js`), and the REST API. Payers can pay by stablecoin or by bank transfer in their own currency (partner-routed, same screening and guardrails). **No card payments.** Details and samples: `docs/INTEGRATIONS.md`. No WooCommerce/Shopify plugin is shipped; the doc gives the pattern and says plainly that any sample is untested.
- **Dashboard**: *Invoices & links* page to create, email, download, copy link, convert, cancel.

## Customer downloads and certificate requests (M13)
- **Statements and settlements** (`/api/statements`, `/api/settlements`, dashboard *Statements*): the account ledger (open obligations, received, fees/payouts, opening/closing per currency) and a per-transfer settlement report (amounts both sides, effective rate, fees, partners, rails, purpose code, invoice, partner and eFIRA references, certificates on file). Formats: JSON, CSV, **XML** and **PDF** (`?format=`), for a session or an API key. Every export states that it is Vaulte's record, not a bank statement or certificate.
- **Certificates per payment**: the transfer's document page shows what is required (eFIRA/FIRC for India receipts; shipping bill and eBRC for goods exports) and lets the customer **request** an eFIRA, FIRC, eBRC, BRC or bank certificate once the payout has completed. Staff see a queue (`/admin/documents`), ask the issuing partner/bank, attach what they send (stored verified), and the request closes itself and emails the customer. A partner can also deliver the certificate directly through the signed `document.issued` webhook, which closes the request the same way. **Vaulte never issues these certificates**; if the issuer cannot or will not, staff reject the request with a reason the customer sees. Set `OPS_EMAIL` to be emailed on each new request.
