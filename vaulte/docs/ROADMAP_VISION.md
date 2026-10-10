# Vaulte: what is left for the vision (plan of 2026-10-09)

Vision: a B2B cross-border settlement layer. The sender pays in a bank currency or a stablecoin (USDC, EURC, USDT where allowed), a licensed partner converts it to fiat at once, and the receiver gets **fiat only** in their own country on a real-time rail (UPI/IMPS in India, SEPA Instant, FedNow/ACH, Faster Payments, UAE rails), at the lowest all-in cost, with Vaulte holding no money and no licence of its own. First wave: **USA, EU, UK, India, UAE**, B2B first.

Dates are working estimates for one engineer, not promises. "Unverified" means built against documentation or a stub, not yet proven on the partner's own sandbox.

## 1. What exists today (proven)
| Area | State |
|---|---|
| Route engine, best-of-N live FX choice, cheapest/fastest/same-day ranking, cost stack on every quote | built, 545 e2e checks |
| Principal-of-record structure (partner holds and converts; Vaulte is agent or tech provider), agent-registration gate per country, partner-customer gate before live routing | built |
| India: fiat-only invariant, UPI/IMPS/RTGS/NEFT picker, recipient bank accounts, eFIRA/eBRC handling and requests | built |
| KYC/KYB: country packs (IN, US, EU27, UK, AE, SA, AU, MY, NP), registry lookups (GLEIF, VIES live-verified), APISetu/CKYC adapters (stub-tested), names only from documents | built, live providers unverified |
| Sanctions: OFAC, UN, UK lists daily; wallet screening (TRM free sanctions check live) | built, live |
| Ledger, statements, ERP exports, invoices, payment links, escrow via partner, certificates | built |
| Currencycloud demo: quotes, customer sub-account with its own funding accounts, deposit, convert, payout | **proven on the demo** |
| Nium sandbox: FX provider, corporate customer onboarding (decision by webhook), customer virtual account, payout request to an Indian bank by IFSC | **built and proven on the sandbox up to the payout**; the payout waits for wallet funds (a simulated third-party credit stays pending); live on the sandbox site: USD>INR quotes use Nium's rate (`INDIA_FX_PROVIDERS=nium`) |
| Circle: the key you sent is a **Circle Console** key (programmable wallets: `/v1/w3s/...` answers, appId returned, 0 wallets). It is **not** a Circle Mint key (`api-sandbox.circle.com` answers 401) and CPN endpoints are not enabled for it | key stored; see section 4 |
| Dashboard: **Partner approvals** page (status, next step, the partner's own link when it needs something), KYB form collects each person's email, phone and address, and **Pay ID** (`name@vaulte`, public page `/id/<name>` with the verified name, receiving accounts per currency and a QR code) | built (553 e2e checks) |
| Two environments: production `vaulte.iaexnetwork.com`, sandbox `vaulte-sandbox.iaexnetwork.com`, legal pack for 5 regions | live |

## 2. What is not built yet (the real remaining work), in build order
| # | Work | Why it matters | Needs from you | Effort |
|---|---|---|---|---|
| 1 | **Nium: sandbox verified end to end (2026-10-10)**; production access and the questions in `docs/NIUM_PRODUCTION_ACCESS.md` remain: regions (SG/UK/EU), Files API, residents' KYC, webhook key, UPI, pricing; confirm in writing that its Indian entity is the authorised party before `INDIA_FX_PROVIDERS` is used live | the India and UAE leg | Nium account manager | 1 to 2 days after their answers |
| 2 | **Partner KYC by webhook** (section 5): customer.approved / needs_info / rejected events into `PartnerCustomer`, requests shown inside Vaulte | the "never contact the customer separately" rule | none (code) | 2 days |
| 3 | **Cashfree** (Payouts + Cross-border/Global Collections) and **Razorpay** (cross-border PA-CB) adapters | the INR landing leg with UPI/IMPS and eFIRA, as the second and third India option | sandbox keys for each; business account in your name | 4 days each |
| 4 | **Stablecoin leg done properly**: Circle Mint (or Bridge) for USDC/EURC deposit addresses held by the licensed partner, off-ramp to USD/EUR, webhooks | the "USDC to USD/EUR to INR without SWIFT" flow | a **Circle Mint** sandbox key (apply at circle.com/mint) or a Bridge sandbox key | 3 days |
| 5 | **US/EU/UK/UAE local rails through partners**: ACH, same-day ACH, FedNow, SEPA and SEPA Instant, Faster Payments, UAEFTS. Rail definitions and ETA already exist; real connectivity comes from partner accounts (Currencycloud, Airwallex, Nium; a US sponsor-bank API such as Modern Treasury or Column for FedNow) | instant settlement outside India | partner accounts; Airwallex answer in about 3 days | 2 to 3 days per partner after its adapter |
| 6 | **TerraPay** adapter | wide payout network for later corridors | sales contract | 4 days, after a signed agreement |
| 7 | **Global payment address** (section 7) and **multi-currency virtual accounts UI** | the "UPI-like" experience | none | 5 days |
| 8 | **More identity APIs** (section 6): passport/ID verification, GST via a GSP, IEC/DGFT, customs | KYC depth per country | vendor accounts | 1 to 2 days per vendor |
| 9 | Settlement reconciliation per partner, fee remittance tracking (section 8), live monitoring and alerts | running it for real | none | 4 days |
| 10 | Security review and a pen test, counsel sign-off per country, partner contracts | go-live | money and time | external |

## 3. Instant settlement and lowest fees: what is honest
- **Instant** depends on the rail and the amount, not on Vaulte: UPI is seconds up to a per-payment limit (default INR 1,00,000 in our config), IMPS up to INR 5,00,000, RTGS above that (hours in bank hours or 24x7 where the bank offers it), SEPA Instant and Faster Payments seconds, FedNow seconds, ACH same-day hours, UAEFTS about an hour. We show the target and publish the measured p50/p90 once at least 5 live transfers exist. The "within 2 hours" promise is a target; compliance review, bank cut-offs and partner outages can break it, so the product never says "guaranteed".
- **Lowest or no markup on both sending and receiving is not sustainable as a promise.** What we can do: (a) receiving into a partner virtual account costs the customer nothing from Vaulte, (b) the sending side carries one visible fee, (c) FX is chosen automatically as the cheapest live quote among all connected partners, so the rate is near mid-market, (d) every quote shows partner cost and Vaulte fee separately, (e) a published "all-in under 1%" target for amounts of USD 5,000 and up. A genuine zero-fee tier is possible only as a time-limited promotion.

## 4. Where Vaulte's charge comes from, how, and how much
Vaulte never holds the customer's money, so it cannot deduct a fee from a balance. Three collection routes, chosen per partner agreement (`FEE_COLLECTION`):
1. **Partner share (default).** The partner's quote already includes Vaulte's markup; the partner pays Vaulte its share on a schedule (monthly or weekly) against a signed rev-share schedule. This is what most embedded-finance programmes do.
2. **Separate invoice.** Vaulte invoices the customer its fee (GST/VAT added) and collects it by card, bank transfer or a payment link. Used for subscriptions and where a partner cannot share revenue.
3. **Spread keep.** For FX partners that sell at a markup over mid, Vaulte's fee is the agreed part of that markup.

**Rates in code today** (basis points of the sent amount, B2B): up to USD 10k 40 bps, to 100k 30 bps, to 1M 20 bps, above 12 bps; floor 8 bps; per-corridor overrides with `MARKUP_BPS_CORRIDORS`; flat-fee tiers for partners that charge flat. Worked examples (Vaulte fee only, partner cost is extra and paid by the customer):

| Sent | Vaulte fee | Partner cost (assumption 5 to 25 bps) | All-in |
|---|---|---|---|
| USD 1,000 | USD 4.00 (floor a flat USD 12 recommended below USD 3k) | about USD 1 to 2 | about 1.3% with the flat floor |
| USD 5,000 | USD 20 | about USD 10 | about 0.6% |
| USD 20,000 | USD 60 | about USD 30 | about 0.45% |
| USD 100,000 | USD 200 | about USD 100 | about 0.3% |

These partner costs are placeholders until Nium, Airwallex, Cashfree, Razorpay and Currencycloud give real rate cards.

## 5. KYC, CKYC, KYB through partner webhooks, without bothering the customer twice
Design (mostly built; step 2 above finishes it):
1. The customer is verified **once, inside Vaulte**, using the country pack (company registry, tax IDs, directors, owners, documents). Identity data is read from documents and registries, not typed.
2. Vaulte submits the verified package to each partner through its onboarding API (`submitCustomer`, proven for Currencycloud).
3. The partner's decision comes back by **signed webhook** (`customer.approved`, `needs_info`, `rejected`). A `needs_info` request appears **in the Vaulte dashboard** as a normal task with the exact missing item; the customer never receives a separate partner email. Vaulte relays the answer to the partner.
4. Honest limit: some regulators require the licensed partner itself to complete a step, for example India's video KYC of the authorised signatory for payment aggregators. The partner's hosted step is then opened from inside Vaulte (link or embedded frame) so the customer stays in one flow, but it is the partner who performs and records it.

Identity APIs by country (to add, each behind the existing provider interface): India: PAN, GSTIN (through a GST suvidha provider), CKYC, DigiLocker documents with the user's consent, IEC (DGFT), bank account check; **Aadhaar numbers are never stored**, Aadhaar proof only through DigiLocker or a masked copy; passport: a document-verification vendor (Sumsub, Persona, Onfido, IDfy or Surepass) rather than a government API; customs and shipping data: ICEGATE needs registration, so for now exports are evidenced by invoice + shipping bill upload + the bank's eBRC; US: EIN and W-9/W-8 forms, state registry lookups through a vendor; EU: VIES, national registers, LEI; UK: Companies House; UAE: trade licence checks through a vendor (no open API).

## 6. Multi-currency virtual accounts
Proven on the Currencycloud demo: each customer gets sub-account **funding details in the customer's own name** (GBP sort code and IBAN, EUR, USD and others). Same pattern for Airwallex global accounts and Nium virtual accounts. Vaulte shows them in one dashboard, credits sweep (convert and pay out) by the customer's rule, and the money sits at the partner, never at Vaulte. India has no INR "global account" for foreign payers: Indian receivers get an INR payout, not an account abroad.

## 7. A global payment address (UPI-style handle)
Build a **Vaulte Pay ID** such as `acme@vaulte`. It is a directory alias, not a new payment network: one handle resolves to the customer's receiving instructions (virtual account per currency, a stablecoin deposit address at the partner, a payment link) and a QR code. The payer's app picks the cheapest, fastest instruction for the payer's country and currency. UPI as an interoperable system cannot be copied, but the handle gives the same experience for B2B invoices: pay by handle, see the exact cost, settle same day. Needs a `PayAddress` model, a public resolve page, QR, API and abuse controls (verified owners only, name shown from the verified record).

## 8. Operating without a licence of our own
Position in each first-wave market (counsel confirms; `LIVE_COUNTRIES` and `AGENT_REGISTRATION_<CC>` keep a country closed until then): the **licensed partner is the regulated provider**, holds funds and converts; Vaulte is its registered agent or programme manager, or a pure technology provider where the partner takes the regulated step.
- **USA:** partners are banks or state-licensed money transmitters; Vaulte as agent/programme manager under their licence; some states regulate agents, which the principal files.
- **EU and UK:** PSD2's technical-provider exemption does not cover payment initiation by Vaulte; operate as an agent registered by the authorised principal, or let the partner be the one that initiates. No live EU/UK service before an Article 27 representative and the principal's agent registration exist.
- **India:** the RBI-authorised payment aggregator (cross-border) or AD bank collects and pays out; Vaulte does not touch the money, and Indian recipients get rupees only.
- **UAE:** a CBUAE-licensed partner (or a free-zone entity under ADGM/DIFC rules) as the regulated party; Vaulte as referral/technology provider until counsel clears an agent model.
This is a structure to confirm, not a guarantee that no registration is ever needed.

## 9. Ways to earn (without holding money)
1. Transaction fee or markup (sections 3 and 4).
2. Share of the partner's FX spread (a negotiated slice, often a few basis points, from each FX partner).
3. Referral/revenue share from payout and collection partners per transferred amount.
4. Subscription for teams: API, ERP sync (Tally, QuickBooks, Zoho), multi-user roles, higher limits.
5. Fees for premium documents: realisation pack, certificate chasing, audit export.
6. Escrow and milestone-deal fee (partner escrow agent holds the money).
7. Monthly fee for extra virtual accounts and Pay IDs for platforms and marketplaces (white-label).
8. **Not available without custody:** interest on balances. Do not plan on it.
Illustration: 40 customers each sending USD 100k a month is USD 4M a month; at an average Vaulte fee of 25 bps that is USD 10,000 a month, plus subscriptions and spread share. Fixed costs of USD 15,000 a month break even at about USD 6M monthly volume, or a lower volume with the subscription tier. Use real rate cards before treating these as forecasts.

## 10. Launch gates for USA, EU, UK, India, UAE (B2B)
Per country: a signed partner agreement naming the principal and who does KYC; counsel's written position on agent registration; the country in `LIVE_COUNTRIES` with `AGENT_REGISTRATION_<CC>=confirmed`; live partner keys only in the production environment; preflight (`scripts/preflight.mjs`) with no failing structure or legal checks; one supervised small live transfer per corridor; measured settlement time published after at least 5 transfers.

## 11. What I need from you next, in order
1. Nium `clientHashId` and region (and whether the sandbox needs our server IP allowlisted).
2. A Circle **Mint** sandbox key, or a Bridge sandbox key, for the stablecoin leg (the Console key you sent is for wallets).
3. Cashfree and Razorpay sandbox keys; TerraPay once they respond; Airwallex when they answer.
4. Names of one lawyer per region, or one firm covering the five.
5. Decide the fee collection route per partner (section 4) once they quote.
