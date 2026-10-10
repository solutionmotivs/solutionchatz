# Keeping India (and Indian customers) out of crypto: the structure

Status: October 2026. **This is a design analysis, not tax or legal advice.** My understanding of Indian crypto taxation below must be confirmed by an Indian chartered accountant and counsel before launch. The point of the structure is that the questions never arise.

## The rule the code enforces

**Nothing on the Indian side touches a stablecoin.**
1. The foreign payer's USDC/USDT/EURC is received and converted to ordinary fiat **by a licensed partner outside India**.
2. India only ever sees a **fiat remittance** (USD, EUR, AED, SAR…) arriving at an RBI-authorised party (PA-CB for business, MTSS/AD bank for personal), which pays **INR** to the recipient's bank account.
3. Enforced in code: the quote engine refuses to route stablecoin to an Indian recipient (`INDIA_DEST_FIAT_ONLY`) or from an Indian sender (`INDIA_ORIGIN_NO_CRYPTO`); and a live partner catalogue is **rejected at load** if any Indian leg carries a token, a chain, an on-ramp or an off-ramp (`assertIndiaFiatOnly`, tested in `tests/india-fiat-only.test.ts`).

## Why this should keep tax and liability away from Indian parties (to confirm with a CA)

- India's special tax regime for virtual digital assets (a flat rate on gains from *transfer* of a VDA and a TDS on the *payment for* a VDA) is aimed at **Indian residents who buy, sell or transfer VDAs**. Under this structure the Indian recipient **never receives, holds, sells or transfers** a VDA: they receive INR from a bank/PA-CB for an export or service, taxed as ordinary business or professional income exactly like any other foreign remittance.
- The foreign payer converts USDC to fiat outside India. Whether *that* is taxable depends on the payer's own country and is theirs to manage. The customer-friendly default is to **offer a plain fiat funding option** (bank transfer in USD/EUR/AED/SAR) so a customer who does not want a crypto step never has one. Stablecoin funding is optional.
- The recipient's paperwork shows a **fiat inward remittance** (eFIRA/FIRC, purpose code, invoice), not a crypto receipt.

## What still needs a professional's answer (do not skip)

1. **The PA-CB or bank's policy:** will they accept fiat whose origin was a stablecoin conversion by a licensed offshore partner, and what source-of-funds documents do they want? (First question for every India partner.)
2. **Is any Indian person a "VDA service provider"?** If Vaulte has an Indian entity or Indian staff, or markets to Indian users, India's anti-money-laundering rules for VDA service providers (registration with FIU-IND) may be argued. Keep the VDA step with the offshore licensed partner and keep Vaulte out of it.
3. **Foreign exchange law (FEMA):** the remittance must come through an authorised channel with the right purpose code; a crypto origin does not change that, but the authorised dealer decides.
4. **GST and income-tax on the underlying export/service** are unchanged by this structure; your customers' advisers handle them.
5. **Offshore VASP exposure:** whether the offshore partner doing the conversion needs to register in India because Indian recipients are involved. The partner's counsel should answer this in writing.

## Customer-money structure (the other liability)

- **Do not run the pooled account yourself.** A design where Vaulte owns a Circle Mint account, converts USDC to USD there, then wires USD onward means Vaulte **holds customer money** in between: that is where licensing and liability come from. The safe shapes are: (a) a **single licensed partner end to end** (for example Circle Payments Network, where Circle's network converts and the beneficiary institution pays INR; Managed Payments puts the licences and custody with Circle), or (b) **each customer's own account** at the partner, or (c) a partner that takes the USDC and pays INR as one regulated service.
- The proposed chain "Circle Mint, then a bank, then Nium/Routefusion/Thunes" should be checked on three points before use: Mint payouts go only to bank accounts registered on *your* Mint account; the Mint fee schedule and any "no fee" claim must be confirmed in Circle's own agreement; and whether the INR payer (Nium, Thunes or others) is itself RBI-authorised for inbound business receipts (PA-CB) or works through an Indian authorised partner. Each is one question to the provider.

## Same pattern for every other currency

For any destination (AED, SAR, SGD, EUR, GBP, CAD, AUD, JPY, USD, …) the shape is the same: **stablecoin in at a licensed offshore partner, converted to fiat there, then the local rail in the landing country** (SEPA Instant, Faster Payments, FedNow/ACH, NPP, FAST, Zengin, Interac/EFT, UAEFTS/Aani, IMPS/RTGS/NEFT, CIPS) by a partner licensed in that country. The router already builds and compares these routes; each real partner is one more leg in `PARTNER_CATALOG_JSON`. Stablecoin availability still follows each market's rules (USDC only on EU, Canada and Japan legs; none in mainland China).

## Speed (honest)

IMPS/RTGS are near-instant; NEFT is typically within hours; conversion and compliance checks add time. The quote shows a target until enough completed transfers exist, then the measured time. Do not promise "instant".

## Questions to hand to the CA / counsel

1. With the stablecoin step done entirely offshore by a licensed partner and an INR payout by an RBI-authorised party, does the Indian recipient have any VDA tax or TDS exposure?
2. Does Vaulte, as an offshore technology platform with Indian recipients, need any Indian registration (FIU-IND) while the VDA step is done by someone else?
3. Which documents will the PA-CB or AD bank need to treat the remittance as a normal foreign inward remittance?
4. How should the eFIRA/FIRC describe the remitter and the source when the origin was a stablecoin conversion?
