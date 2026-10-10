# Nium: what to send for production access, and what to ask

The sandbox (client `IAEX NETWORK`, regulatory region US) is fully wired. Production needs a commercial agreement and live keys from Nium; the sales form at nium.com/talk-to-us is how that starts. Fill it in yourself (Vaulte cannot submit it for you). Suggested text:

**Company:** the legal name in `COMPANY_LEGAL_NAME`. **Industry:** Payments / Fintech. **Monthly volume:** the band that matches your first-year plan (be honest: it affects pricing). **Products:** Payouts, Virtual accounts (collections), FX, Customer onboarding (KYB/KYC).

**Use case (paste):**
> We run Vaulte, a B2B cross-border payments platform for exporters and importers between the US, UK, EU, UAE and India. Customers pay into virtual accounts held in their own name at Nium; Nium converts and pays out in local currency (INR by IMPS/UPI/NEFT/RTGS, AED, GBP, EUR). We do not hold or pool customer money and we do not pre-fund: payouts come only from the customer's own wallet once their funds have arrived. We run KYB/KYC on our side, send you the verified package through the Create Customer v5 and Submit KYC APIs, and take your decisions, RFIs and payment events by webhook so customers are not contacted separately. We need INR payouts with eFIRA/FIRC data, UPI where available, and the SG, UK and EU regions in addition to the US.

## Questions to put to Nium in writing (each came from the sandbox work)

1. **Regions.** The client is regulated in the US: creating a Singapore-region customer fails with "Customer region: SG does not match with client regulatory region: US". Can the programme be enabled for SG (Indian and UAE businesses), UK and EU? Which Nium entity is the provider of record for each?
2. **India.** Which Nium entity is the RBI-authorised payment aggregator (cross-border) for INR payouts, and will you confirm it in writing? (Vaulte only sets `INDIA_FX_PROVIDERS=nium` after that.) INR is not in the client's currency list: please enable it. Per-payment cap, UPI payouts and the UPI proxy field, purpose codes (we send `IR001`), and how eFIRA/FIRC reach us (webhook, API, portal).
3. **Files API.** `POST /api/v1/client/{clientHashId}/files` answers "Missing Authentication Token" on our sandbox key, so documents cannot be uploaded; SG-region customers need `documents` at creation. Please enable it and confirm the multipart field names.
4. **KYC for residents.** `biometric_kyc` is accepted for non-residents but refused for residents of the client's region ("Unsupported kycMode"). Vaulte keeps only masked ID numbers and never sends documents on its own; what do you want for residents (e_kyc with national ID number, manual_kyc with files)?
5. **Webhooks.** Please set our URL `https://<site>/api/webhooks/partner/nium` and a static `x-partner-key` (our `NIUM_WEBHOOK_KEY`) for sandbox and production, and turn on retry delivery (default is at most once) for payout, wallet funding and customer status events. Which event fires when a payer's wire is credited to a customer virtual account? (`CARD_WALLET_FUNDING_WEBHOOK` is documented for the Fund Wallet API only; `INCOMING_FUNDS_WEBHOOK` only for unmatched credits.) Until then Vaulte also polls (`partner-reconcile`, every 2 minutes).
6. **RFI v5.** We answer onboarding questions through the older corporate RFI API (works in sandbox). Please enable RFI v5 and tell us when the older flow ends.
7. **No prefund.** Confirm the programme runs with `postFundedPayout=false` and no client prefund, so that a payout is accepted only against the customer's own settled funds. Our sandbox settles a simulated third-party credit in about 5-10 seconds when the remitter is described; what is the production settlement time per rail and currency?
8. **Pricing and cost model.** The sandbox charges `REMIT_BANK_FEE` USD 1.50 fixed for INR payouts and FX at `markupRate` 0. Please give the production fee schedule (payout, virtual account, FX margin, monthly minimums), so that Vaulte's quote shows the partner cost and our fee separately (`NIUM_LOCAL_FEE_USD`, `NIUM_SWIFT_FEE_USD`, `NIUM_FEE_BPS`).
9. **Third-party funding.** `allowThirdPartyFunding` is true and `whitelistedRemitterAccounts` is empty: how do you screen payers of customer virtual accounts, and can we restrict to named remitters?
10. **Agent model.** Confirm in writing that Vaulte may act as your registered agent or programme manager (not a licensed payment institution), who is principal of record, and whether agent registration is needed in any country we list.

## Moving from sandbox to production (after Nium says yes)

1. Put the live `NIUM_API_KEY`, `NIUM_CLIENT_HASH_ID`, `NIUM_ENV=live`, `NIUM_WEBHOOK_KEY` in `.env.hostinger.local` only (never the repo, never chat) and set them in the production environment.
2. Declare the principal-of-record structure in `PARTNER_STRUCTURE_JSON` for `nium`, set `INDIA_FX_PROVIDERS=nium` only after item 2 is in writing, `AGENT_REGISTRATION_<CC>=confirmed` per country after counsel, and list the countries in `LIVE_COUNTRIES`.
3. Create the crons `partner-reconcile` (2 min) and `partner-onboarding` (10 min) on production (see `docs/HOSTINGER.md`).
4. Run `node scripts/preflight.mjs`, then one very small real payment end to end before opening to customers.
