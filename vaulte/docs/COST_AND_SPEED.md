# Lowest fees and fastest speed: chain, ramp, FX (virtual accounts on hold)

Status: October 2026. Figures come from the public pages named below and move daily; none is an offer. **Re-measure with each partner's sandbox and your own amounts before choosing.** Virtual accounts are on hold (`docs/VIRTUAL_ACCOUNTS.md`, `docs/ARCHITECTURE_PLAN.md` section 2): launch with per-transfer funding instructions and deposit addresses.

## 1. Which chain (USDC/EURC)

Typical cost to move USDC and time to be final, from [Eco's 2026 comparison](https://eco.com/support/en/articles/15261550-cheapest-stablecoin-transfer-services-2026-onchain-routes-ranked-by-fee) and [Spark's calculator](https://www.spark.money/tools/stablecoin-transfer-cost-comparison):

| Chain | Typical fee | Finality | Verdict |
|---|---|---|---|
| **Solana** | under $0.01 (about $0.0001) | about 2 s | **Default.** Cheapest and fastest. |
| **Base** | $0.02 to $0.10 | about 2 s soft | **Second choice.** Cheap, Coinbase ecosystem. |
| **Polygon PoS** | $0.01 to $0.05 | about 5 s | Third. |
| Arbitrum | $0.10 to $0.30 | about 1 s soft | Only if a partner needs it. |
| Ethereum | $2 to $15 | about 13 min | **Avoid** for small and medium tickets. |
| Tron (USDT) | $0.20 to $3 | seconds | **Avoid.** USDT is not allowed on EU legs, and the cost varies. |

Use **USDC on Solana, then Base, then Polygon**. The route engine already keeps the cheapest and fastest chain per leg combination. Circle Mint deposits are offered on Solana, Base, Ethereum and Polygon (our adapter maps these). Catalogue chain fees and delays in `lib/routing/catalog.ts` are placeholders; for the live catalogue list only `solana`, `base`, `polygon` on your legs so the router cannot pick Ethereum or Tron.

## 2. Ramp and conversion fees (stablecoin to fiat)

- **Circle Mint**: issuance and redemption are free (no per-token spread USD to USDC or USDC to USD); no Circle fee on USD bank wires used to mint or settle redemptions (your bank may charge); tiered redemption fee from 15 March 2026: nothing on the first $40M a day, 2 bps from $40M to $100M, 5 bps above ([source](https://help.circle.com/s/article/USDC-redemption-structure), [summary](https://eco.com/support/en/articles/15210359-what-is-circle-mint-enterprise-usdc-account-explained-2026)). Caveat: Mint belongs to the account holder; see the custody warning in `docs/RAMPS.md`.
- **Circle CPN**: fees and FX spread per corridor are not published: **ask** (sales).
- **Circle StableFX**: institutional FX between USDC/EURC and partner stablecoins, liquidity from several providers, sub-second finality on Arc. Permissioned: vetting and an API key from Circle sales; spread not published ([docs](https://developers.circle.com/stablefx.md)).
- **BVNK, Bridge, zerohash**: fees negotiated; not published. **Ask** for a quote on your real corridor.

## 3. Fiat-to-fiat conversion (the biggest cost)

Published starting points: [Wise Platform from about 0.33% at mid-market](https://www.xtransfer.com/eu/blog/best-b2b-cross-border-payment-platforms-2026); Airwallex from about 0.5% over interbank on majors and about 1% on others (same source); Nium and Corpay/Convera negotiated by volume. Our Currencycloud **demo** quoted 1 to 12 bps from mid on demo data (not what live will be). The aggregator asks every enabled provider and picks the lowest landed cost, so **contract three** and let it choose.

## 4. What a transfer really costs (and where to save)

Gas on Solana is a fraction of a cent. The cost that matters is **FX spread plus the India payout fee plus Vaulte's markup**. So: choose Solana/Base for the chain and spend your negotiating effort on FX spread and the PA-CB / CPN payout fee. Ask every provider for an all-in number on USD 1,000 and USD 20,000 into INR.

## 5. Speed ladder (what limits "instant")

1. Chain: seconds on Solana/Base/Polygon.
2. Ramp/convert: Circle mint and redeem are near-instant inside Circle when funded; wires are not.
3. FX and local rail: IMPS/RTGS near-instant, NEFT typically hours, SEPA Instant and FedNow seconds, Fedwire and SWIFT hours to a day, with cut-offs and holidays.
4. Compliance holds and PA-CB checks add time. The quote shows a target until enough transfers are measured, then the measured median and 90th percentile.

## 6. Pick (to confirm with real quotes)

| Slot | First choice | Backup |
|---|---|---|
| Chain | USDC on Solana | Base, then Polygon |
| Ramp / off-ramp (stablecoin to fiat) | Circle (Mint or CPN, whichever structure counsel clears) | BVNK (MiCA-licensed), then Bridge or zerohash |
| FX | Best of Wise, Airwallex, Currencycloud (live competition in the aggregator) | Corpay, Convera, Nium for volume; Circle StableFX if you qualify |
| India landing | Circle CPN (Saber: IMPS/RTGS/NEFT) if access is granted | Cashfree or Razorpay (PA-CB) |
| US rails | Airwallex/Currencycloud USD accounts first | Modern Treasury + a sponsor bank for FedNow/ACH direct |
| EU/UK rails | Wise/Airwallex first | ClearBank, Banking Circle, Modulr |
