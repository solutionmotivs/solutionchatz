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

## Circle Payments Network (CPN): the product that actually lands local fiat (checked 2026-10-07)

Circle Mint (above) cannot pay INR: its payout currencies are USD, EUR, MXN, SGD and BRL, and only to bank accounts registered on your own account. **CPN is the product built for "stablecoin in, local fiat out in another country".** From Circle's public pages:

- Roles: an **Originating Financial Institution (OFI)** sends USDC; a **Beneficiary Financial Institution (BFI)** converts it and pays local fiat to the receiver.
- Live payout corridors named by Circle: **India INR** (Saber: IMPS and RTGS near-instant, NEFT typically under 2 hours), **UAE AED** (LuLu Financial Holdings, FTS), **Singapore SGD** (Tazapay, FAST), **EU EUR** (Saber, SEPA), **US USD** (Tazapay, Fedwire), **Philippines PHP** (Coins.ph).
- API flow: request quotes from several BFIs, accept one, encrypt the travel-rule and beneficiary data, sign the USDC transfer, then the BFI settles in fiat; track by API and webhook.
- An OFI needs USDC liquidity, a custody or signing solution, and its own KYC/AML. Circle's pages do not say what licence an OFI needs: **that is the question to put to Circle and to counsel.**
- **CPN Managed Payments** is the variant where Circle holds the assets, the licences and the compliance, and the partner stays in fiat. It is **by Circle's invitation and a formal agreement**; the public docs give no sandbox details.

What this means for Vaulte: the USDC-to-INR (and AED, SGD, EUR, USD) landing can be one CPN call instead of a chain of ramp + FX + India payout partners. It becomes a **leg in the route engine** next to the others, so the router can compare it with Cashfree/Razorpay-based routes on price and measured time. No adapter is written yet because there is no sandbox access: ask Circle for CPN (ideally Managed Payments) access and say "Circle CPN ka sandbox mil gaya"; I will then read its API reference and build the adapter.

Questions for Circle: (1) Can Vaulte originate through Managed Payments without holding its own licence, in which countries? (2) Sandbox and webhook signing? (3) Fees and FX spread per corridor? (4) Does the INR payout come with an eFIRA, and who issues it? (5) Per-transfer limits and the purpose-code/invoice data Saber needs for India.
