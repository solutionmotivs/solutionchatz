# What each partner's public docs say, and how it fits Vaulte's model

Checked 2026-10-08 from the public documentation each provider publishes (no keys, nothing signed). "Fits" means: the partner can be the licensed principal that holds the money while Vaulte onboards and instructs. Prices and limits are the provider's own claims; confirm in a contract.

| Partner | What it does for us | Fits the no-custody model? | State here | Next step |
|---|---|---|---|---|
| **Airwallex** | FX, global accounts, local/SWIFT payouts. No INR account, no PA-CB | Yes, with connected accounts (customer-named) | Adapter built, stub-tested | Sandbox key: `node scripts/partner-smoke.mjs airwallex` |
| **Currencycloud** | FX rates, funding accounts. INR not tradeable on the demo | Yes (sub-accounts) | Adapter built; **live demo FX verified** | Ask to enable funding accounts; production terms |
| **Wise Platform** | Mid-market FX, transfers | Yes | Adapter built, stub-tested | Platform client credentials from Wise onboarding |
| **Circle Mint** | USDC/EURC mint and redeem, payouts only to the account's own banks | Only if each customer holds their own Mint account | Adapter built, stub-tested, key not verified | Sandbox key; confirm structure with counsel |
| **Circle Payments Network (CPN)** | Stablecoin in, local fiat out (India INR via Saber, UAE AED, EU, US) | **No as OFI**: the OFI holds an operational USDC wallet and signs the on-chain payment (Vaulte would hold USDC). Only **Managed Payments** (Circle holds assets and licences, by invitation) fits | Not built, on purpose | Ask Circle for Managed Payments access; until then no adapter |
| **Bridge (Stripe)** | USDC/EURC/USDT to and from USD (ACH, FedNow, wire), EUR (SEPA), GBP (Faster Payments), MXN, BRL, COP. Customers are onboarded at Bridge by API or hosted KYC link; liquidation addresses auto-convert deposits to the customer's bank account | Yes for the offshore stablecoin-to-fiat leg (customer-level accounts). **No INR and no AED rails**, so it cannot land India itself | Not built | Developer account (support@bridge.xyz), sandbox key. Role: USDC to USD/EUR leg, then an INR partner |
| **Razorpay** | RBI PA-CB licensed. International Bank Transfer: USD/GBP/EUR virtual accounts for Indian exporters, INR settlement, FIRC "within minutes", 1 business day, **1% flat with zero FX markup** (their claim) | Yes: Razorpay is the regulated principal. Its customer is the Indian exporter, so Vaulte needs a partner/ISV arrangement | Not built | Ask Razorpay for a partner programme and sandbox; it is also the price benchmark to beat |
| **Cashfree** | Indian payouts to bank, UPI, cards, wallets (Payouts API); legacy adapter exists in `lib/psp/cashfree.ts`. Cross-border export product must be asked for | Payouts: last mile inside India only, funded by the PA-CB. Cross-border: unconfirmed | Payout client exists | Ask Cashfree for the PA-CB export product and sandbox |
| **Nium** | Payouts to 190+ countries, rail preference, payout validator, customer onboarding v5 API with a sandbox status simulator | Yes (Nium holds the funds; customers onboarded at Nium) | Not built | Sandbox/API key; confirm India INR coverage and UPI in Supported Countries |
| **TerraPay** | Mobile-wallet and bank payout network | Probably | Docs not reachable from here | Contact TerraPay for docs and sandbox |
| **BVNK, zerohash, Modern Treasury** | Stablecoin orchestration (BVNK), US licensed ramps (zerohash), payment operations over a bank (Modern Treasury) | Case by case | Docs reachable; not built | Keys, then one at a time |

## What this changes in the plan

1. **Razorpay's published price (1%, zero FX markup, FIRC in minutes) is the benchmark for India export receipts.** Vaulte's all-in price has to be at or below it to win on price, or Vaulte must win on something else: multi-partner best rate, same-day landing, HS/purpose-code checks, escrow and invoicing in one place, stablecoin payers.
2. **Circle CPN as OFI is out** of the no-custody design. Only Managed Payments fits.
3. **Bridge covers the stablecoin-to-USD/EUR/GBP leg but not India or the UAE.** The India leg stays a PA-CB (Razorpay/Cashfree/PayU...) and the UAE leg a local partner.
4. **Next adapters, in value order, each as soon as a sandbox key exists:** Razorpay PA-CB (India landing + FIRC), Bridge (stablecoin to fiat), Nium (payout network and onboarding), Cashfree (India payout rails).
