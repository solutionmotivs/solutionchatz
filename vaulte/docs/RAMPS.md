# On-ramps and off-ramps (USDC, USDT, EURC)

Plain status, October 2026. Vaulte never holds funds: every ramp below is run by a licensed partner. Nothing here is legal advice.

## What exists in the product

| Item | State |
|---|---|
| Tokens | USDC, USDT, **EURC** (euro stablecoin). A token is priced in the currency it redeems for: USDC/USDT in USD, EURC in EUR. Quotes refuse a mismatch (`INVALID_FUNDING`). |
| EU rule (MiCA) | USDC and EURC allowed on EU legs; USDT is not offered on EU-licensed legs. Canada and Japan legs: USDC only (platform/regulator practice, verify with counsel). Mainland China: no stablecoin leg; onshore yuan is fiat only. |
| On-ramp (fiat in, stablecoin to partner) | Modelled as `ONRAMP_FIAT` legs. Test mode: mock legs for EU, UK, US, UAE, CA, AU, JP, HK (incl. CNH). Live: only legs in your signed partner catalogue. |
| Off-ramp (stablecoin in, local fiat out) | Modelled as `OFFRAMP` legs, same coverage. Fiat lands in the **receiver's country** on a local rail (SEPA Instant, Faster Payments, FedNow/ACH, NPP, Zengin, FPS, Interac/EFT, UAEFTS/Aani, CIPS for CNH) or as INR through an RBI-authorised partner. |
| Any currency to INR | Fiat in (USD, AED, EUR, GBP, SGD, CAD, AUD, JPY, HKD, CNH) or stablecoin in; INR is paid by a PA-CB (business) or MTSS (personal) partner. Never directly by Vaulte. |
| Real ramp adapter | **Circle Mint** (`lib/psp/circle`): USDC and EURC deposit addresses, wire funding instructions, SEPA/SEPA Instant/wire redemption. Contract-tested against a stub built from Circle's published OpenAPI. Live-verified only: `GET /ping` and that the business-account paths demand a key. **Not verified with a key.** Run `node scripts/partner-smoke.mjs circle` with your sandbox key. |

## Circle Mint: read before using live

1. **First-party only.** Mint payouts go to bank accounts registered on the Mint account itself. A Mint account owned by Vaulte that pools customers' money would make Vaulte the holder of that money. Use it only in a structure counsel has cleared, for example each customer's own Mint account, or Circle Payments Network (third-party payouts with Circle as the licensed party), which needs a contract and a different API (`cpn-ofi`).
2. **Notifications.** Circle sends SNS notifications whose certificate signature is not verified in this adapter, so webhooks are refused (`verifyWebhook` returns false). Confirmation needs a status poller (`getPayout`, `getTransfer`, helper `CirclePartner.eventForPayout`) added once you have an account.
3. **Chains.** Mint deposit addresses exist for Solana, Base, Ethereum and Polygon here; TRON is not offered, so USDT-on-TRON is not available through Circle.
4. Configure with `CIRCLE_API_KEY`, `CIRCLE_ENV=sandbox|live`, `CIRCLE_WIRE_ACCOUNT_ID`, `CIRCLE_PAYOUT_DESTINATIONS_JSON`, `CIRCLE_NOTIFY_EMAIL`.

## Other providers (not built; each needs a contract or key)

Bridge (Stripe), BVNK, Transak, Ramp, Banxa, MoonPay, Bitstamp, Coinbase: probe results from this build environment: Circle sandbox reachable; BVNK sandbox answers 401 (key needed); Bridge, Transak, Ramp, Banxa sandbox hosts answer 404 on the bare host (their API paths need accounts); MoonPay unreachable from here. None of these has an adapter. The `StablecoinPartner` interface (`lib/psp/stablecoin/partner.ts`) is the template: implement `createDeposit`, `createFiatFunding`, `createPayout`, `verifyWebhook`, `normalizeWebhook`, register the id in `lib/psp/stablecoin/registry.ts`, add its legs to `PARTNER_CATALOG_JSON`.

## Speed

Typical times are in the catalogue and every quote's `timing` block says whether the figure is a target or measured on completed transfers. On-chain confirmation is seconds to minutes; fiat rails range from seconds (SEPA Instant, FedNow, Faster Payments, NPP, FPS, IMPS/UPI) to a business day (SWIFT, ACH, CIPS windows). Compliance holds add time. Do not promise "seconds" or "under 24 hours"; publish the measured numbers.
