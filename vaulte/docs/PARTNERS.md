# Partner shortlist: who can run each part of Vaulte

Status: October 2026. **A shortlist, not a final choice.** Nothing here is a recommendation to sign, a statement about anyone's licence, or a promise of price. Names come from public sources and my own knowledge (cut-off June 2026); each must be confirmed with the provider and against the regulator's own register before you rely on it. Vaulte holds no funds, so every row is a **licensed party that holds or moves the money**.

Sources used for the checks marked (S): [RBI PA-CB overview and 2026 list](https://www.winvesta.in/blog/businesses/19-firms-got-rbis-pa-cb-license-who-won-and-why), [PA-CB ₹25 lakh cap](https://www.winvesta.in/blog/businesses/rbis-25-lakh-cap-on-cross-border-payments-what-to-know), [FedNow third parties](https://explore.fednow.org/resources/third-parties-fednow-service.pdf), [MiCA stablecoin API providers 2026](https://dashdevs.com/blog/best-stablecoin-api-providers/), [ClearBank SEPA/FPS](https://clear.bank/learn/insights/which-banking-provider-offers-a-global-payments-api-that-supports-both-uk-faster-payments-and-european-sepa-transfers-through-a-single-integration), [Banking Circle](https://www.bankingcircle.com/payments/), [2026 cross-border comparison](https://www.xtransfer.com/eu/blog/best-b2b-cross-border-payment-platforms-2026).

## How to choose (applies to every slot)

1. **Two or three per slot**, never one: Vaulte's router fails over and compares live quotes, so a second and third partner are what make "best rate" and "same day" real.
2. **Licence first.** Ask for the licence number, the entity that actually holds your customers' money, and confirm it on the regulator's register.
3. **Customer-money structure.** Written confirmation that customer funds are held in the account holder's name or in a safeguarded structure and never in a Vaulte-owned balance (L4).
4. **Sandbox and webhooks:** documented API, signed webhooks, idempotency keys.
5. **Certificates** (India): who issues the eFIRA/FIRC/eBRC, how fast, API or email.
6. **Measure, don't believe.** Run the same corridor and amount through each candidate's sandbox or a small live pilot, and compare firm quotes. The FX aggregator (`lib/fx/aggregator.ts`) records the spread against mid-market for every quote; that, plus the measured settlement times, is the evidence.

## India (the core corridor)

| Slot | Candidates to approach | Notes |
|---|---|---|
| **INR payout for export receipts: PA-CB** | Cashfree Payments, Razorpay, PayU, BillDesk, Juspay, Adyen India (S: all reported as RBI PA-CB authorised, roughly 19 to 25 entities in total) | Verify on RBI's own list, which changes. PA-CB per-transaction cap is **₹25 lakh** (S); above that an AD bank is needed. Ask each: do they accept fiat whose origin was a stablecoin, and what source-of-funds documents do they want? |
| **INR payout, personal remittances** | An AD-I bank's MTSS tie-up, or an Indian MTSS agent | Small caps; rules are strict. Decide whether to serve this at launch. |
| **Outward from India (LRS, imports)** | An AD-I bank, or PA-CB (import) | Outward crypto is never offered. |
| **eFIRA / eBRC** | The PA-CB or its AD bank issues; DGFT portal for eBRC | Ask for API or webhook delivery; otherwise the inbound-email route in `docs/CERTIFICATES.md`. |
| **Export-receipt platforms (competitors and possible partners)** | Xflow, Skydo, Winvesta | They already do this for Indian exporters. Treat as competitors to study and as possible liquidity/PA-CB partners. |
| **Government KYC data** | APISetu (CKYC, BureauID AML/PEP, OCR), Sandbox.co.in | Needs your credentials and, for CKYC, regulated-entity status. |

## US rails: ACH, Fedwire, FedNow, RTP

Vaulte cannot connect to these networks directly. The Federal Reserve notes institutions connect directly or through service providers (S); fintechs normally reach FedNow through a **sponsor bank** or a payment-infrastructure API on top of one.

| Slot | Candidates to approach | Notes |
|---|---|---|
| **ACH + Fedwire + FedNow collection and payout (USD funding)** | A sponsor bank with an API (examples to evaluate: Column, Increase, Lead Bank, Cross River, Evolve), or an infrastructure layer on one (Modern Treasury, Finzly, Narmi's FedNow API (S), Dwolla, Moov) | From memory except where marked (S); confirm each supports FedNow *and* your use (collecting from a buyer, paying out). Ask about return handling and same-day ACH cut-offs. |
| **USD funding via an FX/payments wallet instead** | Airwallex, Currencycloud, Wise (US) | Simpler first step: they already give local USD details (see virtual accounts). |

## Europe and UK rails: SEPA, SEPA Instant, Faster Payments

| Slot | Candidates | Notes |
|---|---|---|
| **SEPA / SEPA Instant / Faster Payments as a direct participant or bank** | ClearBank (direct participant, one API for FPS and SEPA (S)), Banking Circle (licensed bank, SEPA Instant and Faster Payments (S)), Modulr (FCA-regulated EMI, SEPA Instant + UK schemes (S)) | EU instant payments rules (including payee-name checks) shape the flow; ask each how they handle them. |
| **Via the FX/payments providers** | Wise, Airwallex, Currencycloud | Often enough for a first launch. |

## FX: instant conversion and best rates

Vaulte asks every enabled provider for a firm quote and picks the cheapest landed cost (`lib/fx`). Contract **three** so competition is real:

| Rank to evaluate | Provider | Why | Adapter |
|---|---|---|---|
| 1 | **Airwallex** | API-first; reported fees from about 0.5% over interbank on majors (S); global accounts in many currencies; **no INR account and no RBI authorisation**, so it serves non-India legs | built, stub-tested |
| 2 | **Wise Platform** | Mid-market rate model, reported from about 0.33% (S); many local rails | built, stub-tested |
| 3 | **Currencycloud** | Detailed rates API, funding accounts; part of Visa | built, stub-tested |
| 4 (volume, negotiated) | Corpay, Convera, Nium, Ebury | Better for large volumes and exotic currencies; no adapter yet | not built |

Reported prices vary by plan and volume; none of the figures above is an offer. The answer to "who gives the best rate" is whatever the aggregator measures on your real amounts.

## Stablecoin conversion and on/off-ramps

| Slot | Candidates | Notes |
|---|---|---|
| **USDC and EURC issuance, mint/redeem, EU (MiCA)** | **Circle** (French EMI licence; USDC and EURC are MiCA-compliant (S)) | Adapter built (`lib/psp/circle`). Mint payouts go to the account's own registered banks; see `docs/RAMPS.md` for the custody caution and unverified webhooks. |
| **Orchestration, ramps, B2B payouts** | **BVNK** (reported MiCA licence, USDC/USDT/EURC (S)), **Bridge** (Stripe), **zerohash** (US multi-state money-transmission licences (S)) | No adapters yet. `StablecoinPartner` is the template. |
| **Consumer-style on/off-ramp widgets** | Transak, Ramp, Banxa, MoonPay | Useful for small tickets; check MiCA/CASP status per country. |
| **USDT** | Not on EU-licensed legs (MiCA). Elsewhere only where the partner's market rules allow | Canada and Japan legs are USDC only in the catalogue. |
| **Wallet screening / travel rule** | Chainalysis, TRM Labs, Elliptic; Notabene for travel rule | Today Vaulte screens addresses against the OFAC list only. |
| **UAE / Singapore / US licensed VASPs** | VARA/ADGM-licensed (UAE), MAS-licensed (SG), state-licensed MSB (US) partners | Pick per corridor after the legal opinion; none contracted. |

## Everything else Vaulte uses

| Slot | Candidates | Notes |
|---|---|---|
| **KYC/KYB, global** | Sumsub, Onfido, Persona, Veriff, IDfy, Signzy | Today: registries + APISetu adapter + mock. |
| **Sanctions / PEP data (commercial)** | ComplyAdvantage, Dow Jones, LSEG World-Check | Today: OFAC, UN, UK lists, free. |
| **Escrow agent** | A licensed escrow agent per country | Live escrow stays off until one is contracted. |
| **Email / OTP** | Resend (adapter built), Postmark, AWS SES | |
| **Accounting** | QuickBooks, Zoho Books, Xero, Tally | Connectors built. |
| **Hosting** | A cloud region in India for Indian payment data (AWS Mumbai, Azure/GCP India, or an Indian provider) | The Render demo runs in Oregon and is test-mode only. |

## Rails, one line each (who gives access)

| Rail | Reached through |
|---|---|
| ACH, Fedwire, FedNow, RTP (US) | sponsor bank / infra API above, or Airwallex/Currencycloud/Wise USD accounts |
| SEPA, SEPA Instant (EU) | ClearBank, Banking Circle, Modulr, or the FX providers |
| Faster Payments, CHAPS (UK) | same |
| NPP (AU), FAST (SG), FPS (HK), Zengin (JP), Interac/EFT (CA), UAEFTS/Aani (UAE), CIPS (CNH) | Airwallex, Wise, Currencycloud where offered; otherwise a local partner bank |
| IMPS, UPI, RTGS, NEFT (India) | the Indian PA-CB / AD bank |
| SWIFT (fallback everywhere) | the FX providers or a correspondent bank |
| On-chain USDC/EURC | Circle / BVNK / Bridge / zerohash |

## Suggested order to actually finalize

1. **Counsel first** (L1): which countries you open. Nothing below is signed before that.
2. **Corridor 1: US to India (business).** Contract: (a) a US USD funding route (a sponsor-bank API for ACH/FedNow, or Airwallex/Currencycloud USD accounts), (b) **two PA-CB candidates** from the India list, (c) the FX providers above (3), (d) Circle or BVNK for the stablecoin leg. Ask every one the questions in "How to choose".
3. Put their legs in `PARTNER_CATALOG_JSON`, set `LIVE_COUNTRIES` to the cleared countries, run `node scripts/preflight.mjs`, then a small pilot with daily reconciliation.
4. Add Europe (SEPA/MiCA) and the other currencies one corridor at a time.

## What I cannot finalize for you

Signing, price negotiation, licence verification, and the legal view that each structure keeps Vaulte outside licensing in each country. I can run `scripts/partner-smoke.mjs` and write each adapter as soon as you hold sandbox keys, and I will report the measured quotes and times.
