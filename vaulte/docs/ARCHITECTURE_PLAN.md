# Plan: how Vaulte takes money in, converts it, and lands local fiat (USDC and fiat, any currency, INR first)

Status: October 2026. A plan, not legal advice. Facts about providers come from their public documentation (cited by name); anything marked **ask** must be confirmed with the provider in writing. Companion docs: `PARTNERS.md`, `PARTNER_SETUP.md`, `RAMPS.md`, `VIRTUAL_ACCOUNTS.md`, `INDIA_CRYPTO_STRUCTURE.md`.

## 1. The question: "will clients get virtual accounts at Circle CPN or Currencycloud? If not, use xReserve?"

| Product | Gives each of your clients their own receiving account details? | What it is |
|---|---|---|
| **Circle Payments Network (CPN)** | **No.** It is a payment *network*: an originator sends USDC, a beneficiary institution pays local fiat. Not an accounts product. | The payout rail that lands INR, AED, SGD, EUR, USD, PHP. |
| **CPN Managed Payments** | **Partly, on the crypto side only:** merchant sub-accounts for bookkeeping and stable USDC receive addresses; Circle holds assets and licences. Fiat bank details per client: **ask**. By Circle's invitation. | Circle as the licensed party; you stay in fiat. |
| **Circle Mint** | A wire account on a Mint account can be flagged `virtualAccountEnabled` in the API: **ask** whether per-client use is allowed. Payouts only to the Mint account's own registered banks. | USDC/EURC mint and redeem for the account holder. |
| **Circle Wallets** | **No fiat details.** Developer-controlled wallets: *you* operate the wallets (keys secured by Circle MPC): that is custody by Vaulte. User-controlled wallets: the customer holds the keys: non-custodial, but crypto addresses only. | Wallet infrastructure. |
| **Circle xReserve** | **No.** It lets a blockchain team issue its own USDC-backed token; Circle holds the reserve. No per-customer or fiat accounts. Using it would make Vaulte the issuer of a token: a heavier regulatory position, the opposite of the goal. **Do not use.** | Token-issuance infrastructure. |
| **CCTP, Gateway, Paymaster, App Kits, Nanopayments, Contracts, Arc** | **No.** Plumbing to move USDC between chains, pay gas, or build apps. Useful later, not for accounts. | Developer tools. |
| **Currencycloud** | **Yes, technically:** sub-accounts ("named accounts") per end customer, each with its own funding details (IBAN via SEPA, ACH, EFT, FPS) fetched with the sub-account id; the demo can emulate inbound funds. But its guide describes this for an operator that is itself regulated (for example an FX broker or money-services business) under a compliance model agreed with Currencycloud, and **our demo account has no funding accounts enabled**. Whether Vaulte, unlicensed, can use it, and who does KYC, is the **question to ask Currencycloud and counsel**. | FX and payments, with a collections product. |
| **Airwallex** | Global accounts per connected account in many currencies; same agreement/KYB question. Cannot land INR. | FX and payments. |

**Answer: no Circle product gives per-client fiat virtual accounts that Vaulte can simply switch on, and xReserve is not a substitute.** Per-client accounts exist at Currencycloud and Airwallex, under an agreement.

## 2. You do not need per-client virtual accounts to launch

Per-client accounts are one way for a payer to send local-bank money. There are two simpler, licence-lighter ways that are already built:

1. **Per-transfer funding instructions (fiat).** For every transfer the licensed partner returns one-time bank details plus a unique reference (`createFiatFunding`). The payer wires or pays locally to the *partner's* account with that reference. Vaulte never holds the money and no per-client account exists. Circle's wire instructions work this way (tracking reference in the memo).
2. **Per-transfer USDC deposit address (stablecoin).** The licensed partner returns a one-time address (`createDeposit`). Same custody position.

Add per-client virtual accounts **later**, only when a partner's agreement says in writing who the account holder is and who does KYC.

## 3. The money flow (every currency, INR first)

```
Payer (USD, EUR, AED, SAR or USDC/EURC)
  -> [Funding]    one-time bank details or deposit address, issued by a LICENSED PARTNER (not Vaulte)
  -> [Convert]    licensed partner converts stablecoin to fiat OFFSHORE, or converts fiat to fiat (best of 2-3 FX providers)
  -> [Land]       local rail in the landing country by a partner licensed THERE
                  India: IMPS / RTGS / NEFT by an RBI-authorised party (PA-CB, AD bank) -> INR in the bank, eFIRA/eBRC
                  UAE: UAEFTS/Aani   EU: SEPA / SEPA Instant   UK: Faster Payments   US: FedNow / ACH / Fedwire
                  SG: FAST   CA: Interac/EFT   AU: NPP   JP: Zengin   CNH: CIPS
Vaulte: quote, route choice, KYC/sanctions/HS checks, memo ledger, status, documents. Holds no balance.
```

Two ways to build the middle and last steps. The router compares them on price and measured time:
- **A. One network (Circle CPN):** USDC goes in, the beneficiary institution pays local fiat. Corridors Circle names: INR (Saber: IMPS/RTGS, NEFT), AED (LuLu), SGD (Tazapay), EUR (Saber, SEPA), USD (Tazapay, Fedwire), PHP (Coins.ph). Needs Circle's agreement; **ask** about licence position for an orchestrator, sandbox and fees.
- **B. Assembled legs:** licensed ramp (Circle, BVNK, Bridge, zerohash) + FX (Currencycloud, Airwallex, Wise; Corpay/Convera/Nium for volume) + local-rail partner (PA-CB for India; ClearBank/Banking Circle/Modulr; Modern Treasury over a sponsor bank for US). Each is a leg in `PARTNER_CATALOG_JSON`.

## 4. Rules that keep it licence-light (already in code unless noted)

1. Vaulte holds no balance; every credit is swept; the ledger is memo-only.
2. Nothing on the Indian side touches crypto (`assertIndiaFiatOnly`, `INDIA_DEST_FIAT_ONLY`, `INDIA_ORIGIN_NO_CRYPTO`).
3. Live partners only in live mode; mock partners only in test mode; `LIVE_COUNTRIES` gates each country after counsel.
4. RUB and Russia/Belarus closed. USDT not on EU legs; USDC only on Canada/Japan legs; no stablecoin in mainland China.
5. Fiat funding is always offered so no customer is forced into a crypto step.
6. **Next code step (not built):** a `structure` field on each catalogue leg (`PARTNER_HELD`, `CUSTOMER_OWN_ACCOUNT`) and a preflight failure for anything else, so a design where Vaulte owns the pooled account cannot be loaded by mistake.

## 5. Phases

| Phase | What | Who | Cost |
|---|---|---|---|
| 0 Legal | Counsel: which countries, licence position of an orchestrator (L1); Indian CA/counsel: the four questions in `INDIA_CRYPTO_STRUCTURE.md`. | You | Fees |
| 1 FX leg (done) | Currencycloud demo connected; quotes live on the Render demo. Next: Airwallex and Wise sandboxes (self-serve). | You get keys, I verify | Free |
| 2 India landing | Ask Cashfree, Razorpay, PayU, BillDesk, Juspay, Adyen India the first-call questions in `PARTNER_SETUP.md`; ask Circle for CPN / Managed Payments access. I build each adapter when its sandbox key arrives. | You + me | Sandbox free |
| 3 First corridor, test mode | USD/EUR/AED/SAR to INR end to end on sandboxes: funding instruction, conversion, INR payout, certificate, measured time. | Me | Free |
| 4 More corridors | AED, SGD, EUR, USD, PHP via CPN corridors or local-rail partners; SEPA/Faster Payments via ClearBank/Banking Circle/Modulr; US rails via Modern Treasury + sponsor bank. | You + me | Mostly sales-gated |
| 5 Per-client accounts | Currencycloud sub-accounts or Airwallex connected accounts once the agreement names the account holder and KYC owner. | You + me | Per agreement |
| 6 Pilot | Live for one counsel-cleared corridor, low limits, daily reconciliation, measured settlement times. Real money costs partner fees. | Everyone | Fees |

## 6. Questions to send (copy to emails)

**Circle:** (1) Can an orchestrator originate on CPN or use Managed Payments without its own licence, in which countries? (2) Sandbox and webhook signing for CPN? (3) Fees and FX spread per corridor, and expected time per rail? (4) Does the INR payout come with an eFIRA, and who issues it? (5) Per-client fiat details: does `virtualAccountEnabled` allow one per client? (6) Per-transfer limits and the data Saber needs for India.

**Currencycloud:** (1) Which compliance model lets an unlicensed platform use sub-accounts, who is the account holder, who does KYC? (2) Please enable funding accounts (EUR, GBP, USD) on the demo. (3) Can a live account ever trade INR, or is India always through a local partner?

**Every India partner:** the five questions at the end of the first-corridor section in `PARTNER_SETUP.md`.
