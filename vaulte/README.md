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
- **Custody caution**: Airwallex pays from a wallet balance. If Vaulte funds one Vaulte-owned wallet with customer money, Vaulte holds customer funds in transit. Use Airwallex connected accounts (`AIRWALLEX_ON_BEHALF_OF`, needs a platform agreement) or another structure your counsel approves.
- **India** is deliberately excluded from general FX providers: INR in or out stays on RBI-authorised legs (PA-CB / MTSS / AD bank). Airwallex has no INR account and is not a PA-CB.
- **Rails** (`lib/routing/rails.ts`): SWIFT, SEPA / SEPA Instant, ACH / same-day ACH, FedNow, Fedwire, Faster Payments, FAST, NPP, HK FPS, Zengin, UAEFTS/Aani, IMPS/UPI/RTGS. Local rail is preferred where the currency and bank country allow it, otherwise SWIFT. Vaulte reaches these only through partners; times shown are typical, not guarantees.
- Production never quotes from a hard-coded rate table: set `OPENEXCHANGERATES_APP_ID` (or no quote is given).
- Recipient bank details must exist (`BankAccount`) before a real-partner payout; the sandbox mock ignores them.
