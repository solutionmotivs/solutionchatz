# Stablecoin providers, gas and EURC: comparison (research of 2026-10-09) (sources: Circle pages, Circle developer docs, Bridge docs, Due's comparison article, third-party fee guides; Bridge/BVNK pricing is NOT public, figures marked "unverified")

## Why Circle Mint (and not the Console key we hold)
- Circle Mint = the licensed issuer's institutional door: fiat (wire, SEPA, bank network) <-> USDC/EURC 1:1, deposit addresses and redemption to bank, 24/7, 185+ countries. Funds sit at **Circle**, not at Vaulte: this is the no-custody fit. The key we hold is a **Circle Console** key (programmable wallets). Developer-controlled wallets would make **Vaulte the holder** of customer USDC, which the no-custody structure forbids; user-controlled wallets put key management on the customer. So wallets are the wrong tool for the pay-in leg.
- **Eligibility (Circle's own page):** institutional customers only; "not available to individuals"; registered distributors in specific regions minting at scale; KYB + background checks + sanctions screening; approval one day to a week or more; apply through circle.com (Check eligibility / Talk to our team). No published revenue floor (third-party: needs a legal entity and a bank that can wire to Circle's settlement banks). Honest risk: a pre-revenue proprietorship may be declined or asked to route through a regulated distributor.
- **Fees:** Circle's page lists none. Circle blog: Standard redemption free up to USD 15M/day (0.1% above), Basic redemption free but up to 2 business days. A 2024 report had near-instant redemption fees from 0.03% above USD 2M/day. Mint side: third parties say no issuance fee. Wire fees and any minimum: unverified (a third-party guide claims ~USD 25 per wire and a USD 250k minimum; not on Circle's pages). Ask Circle in writing.

## Circle's other products, what each is for us
| Product | What it is | For Vaulte |
|---|---|---|
| Circle Mint | fiat <-> USDC/EURC for institutions | **Yes**: pay-in/off-ramp leg, if approved (or via a distributor) |
| CPN (Circle Payments Network) | permissioned network of licensed banks/PSPs/VASPs: originating institution converts local fiat to stablecoin, beneficiary institution pays local fiat; chains Arc/Ethereum/Polygon/Solana; USDC+EURC; no published fees | Only for **licensed institutions**. Vaulte is not one. Route: **CPN Managed Payments** (enterprise use without holding digital assets) or via a licensed partner that is a CPN member |
| Circle Wallets + Gas Station | developer-controlled wallets; Gas Station sponsors users' gas (5% of gas, paid by card, Circle Wallets only) | Not for customer money (custody). Maybe for Vaulte's own treasury operations |
| Paymaster | pay gas in USDC on EVM (ERC-4337): Arbitrum, Avalanche, Base, Ethereum, Optimism, Polygon, Unichain; 10% of gas (docs say Arbitrum/Base); **no Solana** | Optional for EVM flows |
| CCTP | burn-and-mint USDC across chains (now incl. Stellar from 19 May 2026) | Useful to rebalance partner liquidity |
| Gateway, StableFX, Arc | unified balance; FX engine; Circle's own L1 with USDC as gas (mainnet live 16 Sep 2026; target base fee ~USD 0.01, a target not a guarantee) | Watch Arc; StableFX terms need Circle |
| Alliance Program | partner directory, apply via Circle; webinars/community, no formal revenue share published | Marketing only |

## Providers compared (mostly from Due's article, which ranks itself first and self-reports volumes; I re-checked licences/fees where I could)
| Provider | Strength | Fees (public) | Licences | Fit |
|---|---|---|---|---|
| **Circle Mint** | issuer-direct, 1:1, EURC+USDC, cheapest if eligible | no public fee schedule; redemption free <= USD 15M/day (Circle blog) | issuer (US MTLs, EU EMI via Circle Mint France) | **First choice** for both on- and off-ramp if approved |
| **Bridge (Stripe)** | developer-friendly: customers, virtual accounts (USD, SEPA IBAN, MXN, BRL, GBP beta), liquidation addresses, EURC+USDC on Solana/Base/ETH/Polygon etc.; reliance model (we run KYC, Bridge relies) | ~10 bps + network fee (unverified third party); Stripe's own stablecoin payments 1.5%; Due's article says up to 1% FX | OCC national trust bank charter route, MSB, MTL 48 states; MiCA pending | **Best practical second**: self-serve sandbox, API-first; negotiate volume pricing |
| BVNK | big volume, EU/UK/US licences, MiCA | not public; "BVNK rate" + % fee; targets >= EUR 500k/month | MiCA, EMI, MSB/MTL | when volume exists |
| Due | 85 countries, 14 chains, 5-25 bps majors, AED/GBP/EUR/USD virtual accounts, MiCA VASP + FinCEN MSB | 5-25 bps major pairs, 30-90 exotic | MiCA VASP (Spain), MSB | worth a quote for UAE/APAC; early stage; self-reported |
| Iron (MoonPay) | EU/UK/US licensed settlement | ~1% | MiCA, EMI, 47 states MTL, BitLicense | pricier |
| Zero Hash | licensed infrastructure (BaaS) | USDC mint 0 bps, burn 5 bps (their issuer-fee page, contract may differ) | US MTLs, MiCA | cheap redemption, enterprise contract |
| Coinbase Business | USDC<->USD no spread; wire USD 25 / ACH free / instant 1.5%; a reported 0.10% above USD 5M per 30 days (verify) | | | simple treasury, not an API-first orchestration |
| Conduit / Noah / Sphere / others | Africa/LATAM focus | 10-25 bps | mixed | not our corridors |
Verdict on "who charges least": **Circle Mint** (issuer-direct, no spread) < **Zero Hash / Due** (5-25 bps) < **Bridge** (~10 bps + network, up to 1% FX) < BVNK/Iron. Nobody publishes a binding price; get written quotes from Circle, Bridge, Due and Zero Hash at USD 100k and USD 1M monthly.

## Gas: which chain makes it ~free
USDC per-transfer cost (third-party 2026 figures): Stellar ~USD 0.00001-0.0001 (limited exchange/desk support) < **Solana ~USD 0.0001-0.0003 (best all-round)** < Base/Polygon ~USD 0.01 < Arc ~USD 0.01 target (USDC gas) < Tron USD 0.2-3 < Ethereum USD 2-5. **Plasma: zero-fee USDT transfers, not USDC.** Recommendation: **USDC on Solana as default**, Base as second; Stellar only if both partners support it; Arc to watch. Gas is therefore not the cost to optimise (a fraction of a cent); partner fee + FX spread + our markup are. Gas sponsorship (Paymaster/Gas Station) is optional and EVM-only; on Solana the fee is paid in SOL: keep a small SOL float in the **partner's** deposit-address flow (the partner pays it), so customers never hold SOL.

## EURC
Issued by Circle under MiCA; largest euro stablecoin (~41-50% of the euro segment, roughly USD 220-450M depending on source/date), on ~9 chains (Ethereum, Avalanche, Base, Solana, Stellar, Polygon, Arbitrum, Aptos, Hedera). Liquidity is thinner than USDC (slippage on large swaps), so **mint/redeem through Circle Mint or Bridge, do not swap on DEXs**. Alternatives: EURCV (Societe Generale Forge, ~USD 138M, institutional challenger), EURI (Banking Circle, ~USD 51M), EURe (Monerium). Cheapest and most reliable for us: **EURC via Circle Mint** (or Bridge, which supports EURC on Solana) — and EU users cannot use USDT (MiCA), already enforced in code.

## Recommended path
1. Apply to **Circle Mint** now (legal entity, bank account that can wire, KYB docs; pre-wire a question list: fees, minimums, redemption cap, EURC, chains, API webhooks, sub-accounts/segregated deposit addresses per customer so no pooling, eligibility for an agent model). In parallel ask **CPN** how a non-licensed technology company can use Managed Payments.
2. Open a **Bridge** sandbox (self-serve) as the fallback and for virtual accounts (USD, EUR IBAN): build the adapter against it first because it can be tested now.
3. Default chain **Solana (USDC)**, second **Base**; EURC on Solana/Base.
4. Get written quotes (Circle, Bridge, Due, Zero Hash) before choosing; add the winner as `RAMP_PROVIDER` per corridor in the existing ramp adapter (`lib/psp/ramps`, Circle Mint adapter exists, stub-tested).

Sources: circle.com/mint, circle.com/cpn, developers.circle.com/paymaster, Circle blog (USDC redemption process), Circle Alliance Program pages, apidocs.bridge.xyz, opendue.com/blog/best-stablecoin-payment-providers (a vendor article that ranks itself first), docs.zerohash.com/docs/issuer-fees, help.bvnk.com, Cointelegraph / Decrypt / crypto.news on Arc, third-party 2026 fee guides. Prices marked unverified are not on the provider's own pages: get written quotes.
