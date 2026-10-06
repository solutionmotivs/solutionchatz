# Virtual accounts: what exists, what changed, what to know

*"Virtual accounts wala kya hua, uske APIs bhi."* Status as of October 2026.

## What they are here

Local bank details (IBAN, UK sort code, US ACH routing, Canadian transit, Australian BSB, …) that a **licensed partner issues in the account holder's name**, so a payer abroad can pay them like a local. **Vaulte holds nothing and keeps no balance.** Every credit is converted and paid out at once (`AUTO_SWEEP`); the memo ledger shows the obligation and clears it when the payout completes. The accounts are *collection-only*.

## What changed in this round

| Before | Now |
|---|---|
| Partner chosen by a hard-coded lookup into the mock catalogue (and a live account could even be routed to a mock partner) | **Capability table** (`lib/psp/capabilities.ts`): which partner can issue which currency in which country, with the kind of local details and rails. Test mode uses simulated partners only; live mode uses only contracted partners that are configured with *live* credentials. Operators override with `PARTNER_VA_CAPABILITIES_JSON`. |
| API key only, POST/GET list | Dashboard session **or** API key. New: `GET /api/virtual-accounts/capabilities`, `GET /api/virtual-accounts/:id` (account plus each credit with status and seconds from funds-confirmed to completed). |
| No UI | **Dashboard page** `/dashboard/virtual-accounts` (open an account, see details and credits). |
| EUR/GBP/USD details only | Adds CAD (institution/transit/account), AUD (BSB/account) and JPY/HKD/CNH/SGD/AED. |
| A currency could be opened in any country | A currency is tied to its country (GBP in GB, EUR in EU/EEA, CAD in CA, …). |

## The APIs

```
GET  /api/virtual-accounts/capabilities       what can be opened now (mode: test|live)
POST /api/virtual-accounts                    {entity_id, country, currency, sweep_dest_currency, recipient_entity_id?, default_purpose_code?}
GET  /api/virtual-accounts                    list
GET  /api/virtual-accounts/:id                one account + credits
POST /api/sandbox/partner/simulate            {event:"virtual_account.credit", virtual_account_id, amount, sender_name, sender_country}   (test mode)
```
Webhook event when money lands: `virtual_account.credited` (then the normal `transfer.*` events as the sweep progresses).

## Partners (honest status)

| Partner | Virtual-account support in the adapter | Verified? |
|---|---|---|
| Airwallex | Global accounts (`/global_accounts/create`): USD, EUR, GBP, AUD, CAD, HKD, SGD, JPY, CNH per its public docs | Stub contract tests only. **No INR account at Airwallex and no RBI PA-CB authorisation**: Indian recipients are paid by an Indian partner leg. |
| Currencycloud | Funding accounts: GBP, EUR, USD | Stub contract tests only |
| Wise | Not provisioned by the adapter (Wise issues account details in its own dashboard for your profile) | n/a |
| Circle Mint | Not a virtual-account product here | n/a |
| Test mode | Simulated for every open currency | Fully tested end to end |

Live capabilities are *documented*, not confirmed against your accounts: partners enable currencies per account and per holder country, so confirm at contract and set `PARTNER_VA_CAPABILITIES_JSON` accordingly.

## Rules to keep

- Residents of India: collection-only with **immediate INR sweep** (no foreign-currency balance abroad); the API enforces it.
- The account holder must be verified (KYB/KYC approved) before an account is opened.
- Every payer on a credit is screened against the sanctions lists; a hit holds the transfer for staff review instead of paying out.
- Credits that need an invoice or purpose code (India business payouts) wait in `QUARANTINED: DOCUMENTS_REQUIRED` until the documents are attached.
- Whether issuing local details in a customer's name, through a partner, stays inside a licence-free structure is **counsel's decision per country**; see `docs/COMPLIANCE_MEMO.md`.
