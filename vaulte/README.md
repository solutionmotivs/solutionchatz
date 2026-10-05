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
cp .env.example .env.local        # fill DATABASE_URL, JWT_SECRET, ADMIN_API_TOKEN, CRON_SECRET
npx prisma generate && npx prisma db push
npm run dev
```
Tests: `npm test` (unit) and, with the server running, `node scripts/e2e.mjs` (needs `DATABASE_URL`, `ADMIN_API_TOKEN`, `CRON_SECRET`, `BASE_URL`; run against `next dev` so loopback webhooks are allowed).

Sandbox walk-through: register -> create entities -> `POST /api/admin/entities/verify` -> `POST /api/quotes` -> `POST /api/stablecoin/payins`
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
