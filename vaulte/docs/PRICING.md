# Pricing and unit economics

Status: October 2026. **No price is set by this document.** Real partner costs come from signed agreements; the numbers below are the structure and a way to test whether a price is sustainable.

## The customer's price has two parts, shown separately on every quote

1. **Partner cost**: the licensed partner's FX spread and fees (and the on-chain fee when a stablecoin is used). This is whatever the partner quotes live. Vaulte asks every enabled partner and picks the route (cheapest, fastest or lands-today).
2. **Vaulte fee**: Vaulte's markup, in basis points, by transfer type and size (`MARKUP_TIERS` in `lib/pricing`), optionally overridden per corridor (`MARKUP_BPS_CORRIDORS`). There is a floor (`MIN_MARGIN_BPS`) and a ceiling on the customer's total (`MAX_TOTAL_COST_BPS`).

### Flat-fee and tiered partners
A partner leg can carry a `feeSchedule`: ordered tiers of `{upToUsd, flatUsd, bps}`, the last one open-ended (`upToUsd: null`). Example for a provider that charges USD 19 up to 2,000, USD 29 up to 10,000 and 0.3% above: `[{"upToUsd":2000,"flatUsd":19},{"upToUsd":10000,"flatUsd":29},{"upToUsd":null,"bps":30}]` (see `docs/partners.example.json`). The first tier whose ceiling is not below the amount applies, and its cost is added to the leg's spread, percentage and fixed fee. The route engine uses it when ranking, so a percentage provider wins small transfers and a flat-fee provider wins large ones; the quote shows the result inside "partner cost". Not modelled: GST or other taxes a provider adds on its own fee. Put them in the tier or ask the provider for an all-in figure.

## How Vaulte's fee reaches Vaulte

`FEE_COLLECTION=PARTNER_SHARE`: the licensed partner deducts its cost and Vaulte's fee from the payment and remits Vaulte's fee, so Vaulte never holds customer money. In the books it is "due from partner" (`1100`) against "Revenue - transfer markup" (`4000`); the customer's money stays in memo accounts and never on Vaulte's balance sheet. A second model (Vaulte invoices the customer separately) is not implemented: it changes the delivered amount and the ledger, and counsel/partners should choose first.

## "Lowest fees in the world"

Not promised. What is defensible:

- A **published** fee scale, the **full cost stack on every quote**, and a **comparison against the mid-market rate and a typical bank wire** (`/quote`).
- "Lowest" only where a quote proves it. Published competitor prices (vendor pages, October 2026, check before quoting): Skydo about USD 19 to 2,000 and USD 29 to 10,000 then 0.3%; Xflow from about USD 12 then 0.6%; Winvesta about USD 3 plus 0.99% with no FX markup. Vaulte's edge is not a lower headline price but a **provable same-day landing, the bank certificate attached, and the best of several live partner quotes**.

## Is a price sustainable? A calculator you can run

For one transfer of `A` USD: `revenue = A × markup_bps / 10 000`; `variable cost = payment-provider cost to Vaulte (if any) + KYC/screening per customer + support share`. Vaulte's partner cost is paid by the customer, not by Vaulte, so Vaulte's margin is the markup minus its own per-transfer costs.

| Transfer | At 10 bps | At 20 bps | At 30 bps | At 50 bps |
|---|---|---|---|---|
| USD 1,000 | 1.00 | 2.00 | 3.00 | 5.00 |
| USD 5,000 | 5.00 | 10.00 | 15.00 | 25.00 |
| USD 20,000 | 20.00 | 40.00 | 60.00 | 100.00 |
| USD 100,000 | 100.00 | 200.00 | 300.00 | 500.00 |

(USD of Vaulte revenue per transfer.) **Break-even volume** per month = fixed monthly costs ÷ average revenue per transfer. Example: if fixed costs (people, hosting, KYC subscriptions, insurance, counsel) are USD 40,000 a month and the average transfer earns USD 15, you need about 2,700 transfers a month. Small tickets need a **minimum fee**: below about USD 3,000, a pure basis-point fee often does not cover costs; consider a flat floor (competitors use USD 12 to 29 flat).

## What to decide with real numbers

1. The partner revenue share you can negotiate (ask every partner; it differs by corridor).
2. The fee floor per transfer and the scale by size.
3. Whether to price small tickets differently from large ones.
4. Which corridors are worth opening first by margin and volume (the pilot leads in `/admin/leads` show demand).
