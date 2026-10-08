# Partner setup, one by one (free sandboxes first)

Companion to `docs/PARTNERS.md` (who) and `docs/RAMPS.md`. Status: October 2026. Nobody can open these accounts for you: sign-up needs your identity, company details and email/phone verification, and the keys belong to your account. This file gives the order, the exact place to get each key, and where each key goes.

## Where the keys go

1. **Never paste keys into chat, email or a repo.** Anything in chat is logged.
2. Local: copy `.env.partners.example` to `.env.partners.local` (already git-ignored) and fill in only what you have.
3. The demo/staging server: set the same names as environment variables on Render (dashboard > vaulte-demo > Environment). Cloud sessions are temporary; Render env vars are what persist.
4. Check what works: `node scripts/partner-check.mjs`. It lists every provider, says which keys are missing, and for providers with a safe read-only probe it authenticates against the sandbox (moves no money, creates nothing).
5. Tell me "X ka sandbox key set kar diya". I then read that provider's current API docs, write or fix its adapter, run it against the sandbox, and report the real quote and timing.

## What "free" can and cannot mean

- **Sandbox accounts are free** at most providers, but sandbox money is fake. They prove the integration, not a customer payment.
- **Real customers with real money cost money and need approval**: each provider charges its own fees per transaction, wants business verification (KYB) before live access, and counsel has to clear each country first. There is no free way to move real money through licensed partners.
- **Free customer trial that is possible today:** run the demo (`https://vaulte-demo.onrender.com`) in test mode with design-partner customers. They see the real quotes, flows, certificates and statements, with simulated partners. When a partner's sandbox keys are set, that partner's quotes become real (still test money).

## Order to do it (self-serve first)

| # | Provider | Get a free sandbox | Keys to collect | Unlocks | Adapter today |
|---|---|---|---|---|---|
| 1 | **Airwallex** | Sign up at the sandbox web app (sandbox.airwallex.com); keys under Account > Developer > API keys. Base URL `https://api.sandbox.airwallex.com` | `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY`, `AIRWALLEX_WEBHOOK_SECRET` | FX quotes, payouts, global accounts (USD, EUR, GBP, AUD, CAD, HKD, SGD, JPY, CNH) | built |
| 2 | **Wise Platform** | Test user at `https://wise-sandbox.com/register` (2FA code is always 111111); create a developer account; API token under Settings > API tokens. Client credentials for the Platform come from Wise's partner onboarding | `WISE_CLIENT_ID`, `WISE_CLIENT_SECRET`, `WISE_PROFILE_ID` | mid-market FX quotes, transfers | built |
| 3 | **Currencycloud** | Register a demo developer key at `https://developer.currencycloud.com`. Demo trades run in a demo market and send no real payments | `CURRENCYCLOUD_LOGIN_ID`, `CURRENCYCLOUD_API_KEY` | FX rates, funding accounts (GBP, EUR, USD) | built |
| 4 | **Circle** (Mint now; **CPN** is the one that lands INR/AED/SGD/EUR/USD fiat, see `docs/RAMPS.md`) | Sandbox account at Circle (Mint API); ask Circle for CPN / Managed Payments access; base `https://api-sandbox.circle.com` (its `/ping` answers publicly) | `CIRCLE_API_KEY`, then register a bank account for `CIRCLE_WIRE_ACCOUNT_ID` | USDC/EURC deposit addresses, redemption | built (first-party payout limits: `docs/RAMPS.md`) |
| 5 | **Cashfree** | Sandbox keys are auto-generated in the dashboard (Developers > API Keys); base `https://sandbox.cashfree.com`. Ask them for the **cross-border (PA-CB) export product** and its sandbox | `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET` | INR landing for export receipts | not built |
| 6 | **Razorpay** | Test-mode keys are available in the dashboard without live activation (`rzp_test_...`). Ask about their international/export (PA-CB) product | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | INR landing | not built |
| 7 | **Modern Treasury** | Create an account; API keys under Developers > API Keys; keys decide sandbox vs live. Confirm the sandbox is self-serve for you | `MODERN_TREASURY_ORG_ID`, `MODERN_TREASURY_API_KEY` | US ACH, same-day ACH, wire, RTP, FedNow orchestration over a connected bank | not built |
| 8 | **Bridge** (Stripe) | Email support@bridge.xyz to get a developer account, then generate sandbox keys in its dashboard; base `https://api.sandbox.bridge.xyz` | `BRIDGE_API_KEY` | stablecoin ramps and orchestration | not built |
| 9 | **BVNK** | Ask your BVNK account manager for a sandbox; create Hawk ID/key in its portal; base `https://api.sandbox.bvnk.com` | `BVNK_HAWK_ID`, `BVNK_HAWK_KEY` | stablecoin payments and payouts | not built |
| 10 | **zerohash** | Contact zerohash for **Cert** (sandbox) credentials | `ZEROHASH_API_KEY`, `ZEROHASH_API_SECRET`, `ZEROHASH_PASSPHRASE` | US stablecoin ramps (licensed) | not built |
| 11 | **PayU, Juspay, BillDesk, Adyen India** | Each has a test/UAT environment after merchant sign-up or a sales call. Ask each for the cross-border inbound product with INR settlement and eFIRA | see `.env.partners.example` | INR landing (alternatives to 5 and 6) | not built |
| 12 | **ClearBank, Banking Circle, Modulr** | Sales/onboarding gated; they provision a sandbox. ClearBank and Banking Circle are bank-level participants in SEPA/Faster Payments; Modulr is an EMI | see `.env.partners.example` | SEPA, SEPA Instant, Faster Payments | not built |
| 13 | **Corpay, Convera, Nium** | Contact each (Corpay sandbox `https://crossborder.beta.corpay.com`, technicalsales@corpay.com; Convera needs its onboarding team for OAuth or a client certificate; Nium issues `clientHashId` and an API key in its portal after verification) | see `.env.partners.example` | negotiated FX for volume, exotic currencies | not built |

Start with 1 to 4. They are self-serve, their adapters exist, and together they give you real FX quotes from three competing providers plus the stablecoin leg. Then do 5 and 6 (India), which matter most for your first corridor.

## Modern Treasury and "bank APIs"

- **Modern Treasury** is a payment-operations layer. It sits on top of banks you already have accounts with and gives one API for ACH, same-day ACH, wires, RTP, FedNow and stablecoin payments, plus reconciliation and a ledger. It is not a bank and not a licence: the money sits at the connected bank.
- **Sponsor bank APIs** (for example Column, Increase, Lead Bank, Cross River, Evolve) give you accounts and direct rails. For ACH/Fedwire/FedNow you need one bank behind you: either directly or through a layer such as Modern Treasury.
- **ClearBank, Banking Circle, Modulr** do the same for SEPA, SEPA Instant and UK Faster Payments (ClearBank and Banking Circle are banks, Modulr an EMI).
- **Which one first?** For US to India you can skip the US rails at first: Airwallex/Currencycloud USD accounts take the USD in. Add Modern Treasury only when you need direct ACH or FedNow collection.

## First corridor: USD, EUR, AED, SAR to India

What is already built and tested (against simulated partners):
- USD, EUR, AED fiat or USDC/EURC in; SAR fiat in (Saudi stablecoin routes are not offered); INR out through an Indian PA-CB partner.
- **Automatic conversion with any number of partners:** the router builds every valid route, the FX aggregator asks every enabled provider for a firm quote, and the cheapest (or fastest, or same-day) is chosen; if a partner fails, the next one takes over. USDC arrives at the licensed partner, converts to USD/EUR/AED as fiat at once, and the Indian partner lands INR. Add a partner by registering its adapter and its legs in `PARTNER_CATALOG_JSON`; nothing else changes.

What needs real partners before it moves money: the INR payout partner (5 to 6 above), the stablecoin ramp (4, 8 to 10), the funding route, counsel's clearance for each country (`LIVE_COUNTRIES`), and signed agreements.

Questions to ask every India partner on the first call (write the answers down):
1. Which product receives USD/EUR/AED/SAR by bank transfer and settles INR to an Indian exporter, and does it issue the eFIRA/eBRC? How fast, by API or email?
2. Do you accept fiat that came from a stablecoin conversion by a licensed partner, and what source-of-funds documents do you need?
3. Per-transaction cap, fees, FX margin, cut-off times, and settlement time (IMPS/RTGS/NEFT).
4. Sandbox, webhook signing, and idempotency.
5. Who holds the customer's money between receipt and payout?

## What each partner must declare before it carries live money

Every live leg in `PARTNER_CATALOG_JSON` (and every live FX provider in `PARTNER_STRUCTURE_JSON`) names the **licensed partner as principal and holder of the funds**, who owns the account, Vaulte's role and the signed agreement reference. Without that it does not load. The customer is also onboarded **at the partner** (Vaulte sends its verified KYB package; the partner decides), and live routing waits for `APPROVED`. See `docs/AGENT_MODEL_MEMO.md`; staff record decisions of partners without an API at `/api/admin/partner-customers`.

## When keys arrive

Give me one provider at a time. For each I will: read its current docs, write the adapter if it does not exist, add a contract test and a smoke check, run it against the sandbox, and report the real FX quote, the rail and the measured time. Then the next.

## Verified results

### Currencycloud demo (checked 2026-10-07 with your demo key, read-only)
- Login works. The demo account trades 37 currencies, including USD, EUR, GBP, AED, SAR, JPY, CAD, AUD and **INR**, but **not CNH**.
- Our adapter returned indicative rates for USD>EUR, USD>AED, USD>SAR, EUR>GBP and AED>USD, within 1 to 12 bps of the API's own mid-market rate on demo data. These are demo numbers, not an offer and not what live pricing will be.
- **INR is not tradeable from this account**: USD>INR and EUR>INR answer `Rate could not be retrieved`, and AED>INR and SAR>INR answer `ccy_pair_is_not_tradeable`. So Currencycloud serves the offshore FX leg and **cannot land INR**. The Indian PA-CB partner does that, as designed. Ask Currencycloud whether a live account can ever trade INR (usually through a local partner and not for onward payout to India).
- `funding_accounts/find` returns none for EUR. Funding accounts (virtual accounts) are not enabled on this demo account; ask Currencycloud to enable them before testing virtual-account creation.
- Every quote now carries the provider's trade **cut-off time**; the adapter learns the tradeable currencies from the account itself, so CNH is refused cleanly on this demo.
- Re-run any time: `npx tsx scripts/currencycloud-live-check.ts`.

### Currencycloud demo: customer sub-accounts and a full payout (done 2026-10-08, demo only)
Run `npx tsx scripts/currencycloud-e2e.ts` (creates demo objects only; refuses the live API). It exercises our adapter end to end and passed:
1. **Customer sub-account + contact** (`submitCustomer`): Vaulte's approved KYB profile becomes a Currencycloud sub-account named after the customer (`/v2/accounts/create`), with the account owner as its contact. The customer reference is stored as `<accountId>:<contactId>` in `PartnerCustomer.partnerRef`. Every later call for that customer acts `on_behalf_of` the contact, so money sits in the customer's own sub-account, never a pooled Vaulte account (the structure our memo requires). The demo took these fields, learned one error at a time: `legal_entity_sub_type` (`limited_liability_company`, `public_limited_company`, `limited_liability_partnership`, `unincorporated_partnership`, `sole_trader`), `identification_type/value`, `country_of_incorporation`, `date_of_incorporation`, `industry_type`, `business_website_url`, `trading_address_street/city/country`, `expected_monthly_activity_volume/value`, `expected_transaction_currencies` (one item in the demo), `expected_transaction_countries`, `customer_risk` (LOW/MEDIUM/HIGH). Missing items come back as `NEEDS_INFO` with the list, without calling Currencycloud.
2. **Funding details in the customer's name**: a new sub-account gets its own funding accounts automatically (GBP sort code and IBAN, EUR, USD ...). `createFiatFunding` and `createVirtualAccount` return these. (The master account's own `funding_accounts/create` is "not enabled" on this demo: not needed, sub-accounts get theirs.)
3. **Simulated deposit**: `POST /v2/demo/funding/create` with the customer's contact (`on_behalf_of`), the sub-account id and the funding account number. Demo only; the balance appears in under a minute.
4. **Payout**: beneficiary, conversion (buy side fixed, so the recipient gets the quoted amount) and payment, all on behalf of the customer. The payment sits at `ready_to_send` on the demo (the demo does not release payments).
What this does NOT prove: INR (not tradeable on this account; the PA-CB partner pays INR), CNH (not listed on the demo), live settlement times, the live account's permissions (sub-accounts need Currencycloud to enable them for the live programme).
