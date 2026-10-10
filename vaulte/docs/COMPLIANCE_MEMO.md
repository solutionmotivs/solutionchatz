# Vaulte regulatory memo (draft for your counsel)

**Read this first.** I am an AI engineering assistant, not a lawyer, and nothing here is legal advice. This memo records the legal structure the product was built around, the regulatory regimes I believe apply in each market, and the questions a qualified lawyer in each place must answer before real money moves. Statutes, thresholds and licensing positions change often; my knowledge stops in mid-2026 and I could not look up current law from this environment, so **every citation below must be verified**. Where I am unsure I say so. Software cannot make a product lawful: what the code does is enforce the structure described in section 2 and refuse what it cannot support.

---

## 1. What the product does (the facts counsel needs)

| Fact | Where it is enforced |
|---|---|
| Vaulte never holds customer funds. Licensed partners receive, convert, hold and pay out. | Architecture; ledger accounts 9xxx are memorandum only; no wallet or balance feature exists. |
| Revenue is a markup shown on every quote. Vaulte's markup is deducted inside the partner's flow and owed to Vaulte by the partner ("due from partner", account 1100). | `lib/pricing`, `lib/ledger` |
| Money from India leaves as fiat only. Receipts in India are paid in INR by bank. Stablecoins are only a transfer leg between licensed partners abroad. | route engine guardrails |
| Live money flows only through partners named in a configured catalogue; with none configured there is no live route (fails closed). Test mode uses mock partners only. | `lib/routing/partners-config.ts`, `assertRouteMode` |
| Live corridors can be restricted to counsel-cleared countries (`LIVE_COUNTRIES`); preflight fails if it is unset. | `lib/routing/corridors.ts`, `scripts/preflight.mjs` |
| KYC/KYB, sanctions screening (OFAC SDN, UN, UK; EU optional), wallet screening, risk tiers, two-person approval for enhanced due diligence, purpose codes and invoices for Indian business receipts, LRS / MTSS / PA-CB limits. | `lib/kyc`, `lib/sanctions`, `lib/guardrails` |
| Escrow: only a licensed escrow agent can hold money; no live agent adapter ships, so live partner escrow is disabled. A second mode (pay-on-approval) holds nothing and is labelled "not escrow". | `lib/escrow` |
| Invoices, payment links and checkout are a seller's tool; Vaulte is not a party to the sale and prints the seller's tax particulars as entered. | `lib/invoices` |
| Documents Vaulte generates are labelled as Vaulte records, never as eFIRA / FIRC / eBRC / bank certificates. Certificates are requested from issuers and stored. | `lib/documents`, `lib/reports` |
| Draft legal pages carry a "draft for legal review" banner until `LEGAL_REVIEWED=true`. | `lib/legal.ts` |

## 2. The three questions that decide everything

Every jurisdiction below turns on the same three questions. Get written answers to these before anything else.

1. **Perimeter.** Does *instructing* licensed partners on a customer's behalf, comparing their quotes, choosing the route, showing instructions to the payer and collecting a markup make Vaulte itself a payment institution / money transmitter / remittance provider / payment aggregator / "money services business" in the countries of the payer, the payee, or Vaulte's own establishment? Many regimes ask who has control over the funds *or* the payment instruction, who is the customer-facing party, and who earns the fee from the flow. "We never touch the money" is necessary and often not sufficient.
2. **Agency.** If the partners are licensed and Vaulte acts as their distributor, introducer or agent, does each licence allow it, and must Vaulte be registered as an agent or disclosed to the regulator (EU/UK payment-services agents, US agent-of-licensee rules, Malaysian and Australian agent concepts)? Is the markup "taken from the flow" a sign of agency?
3. **Marketing claims.** What may be said, and where, about "no licences needed", "instant", "lowest rate", "escrow", "no crypto tax" and "bank certificates"? The product text avoids these claims, and your own marketing must too: unlicensed-service allegations are often built from marketing.

Until counsel signs off on 1 and 2 for a given country, keep that country out of `LIVE_COUNTRIES`.

## 3. Country by country

For each market: the regulators and laws I believe are relevant; what probably needs a licence; what the product already does; and what counsel must decide. "Verify" means I am not certain of the current text.

### 3.1 India

- **Regulators and laws.** RBI; Foreign Exchange Management Act 1999 (FEMA) and its rules; Payment and Settlement Systems Act 2007; RBI Master Direction on payment aggregators and the cross-border payment-aggregator guidelines (PA-CB, 2023; authorisation, net-worth thresholds and per-transaction limits: verify current figures); Money Transfer Service Scheme (MTSS) for inward personal remittances through authorised agents; Liberalised Remittance Scheme (LRS, USD 250,000 per resident per financial year; tax collected at source applies to many LRS uses: verify current rates and thresholds); Prevention of Money Laundering Act 2002 and RBI KYC Master Directions; Income-tax Act provisions on virtual digital assets (30% tax and 1% TDS on transfers: verify); GST (including treatment of export of services and of Vaulte's own fee); Digital Personal Data Protection Act 2023 and the DPDP Rules (verify commencement dates); IT Act intermediary rules (grievance officer); RBI storage-of-payment-data directive (payment data in India).
- **What probably needs a licence.** Facilitating cross-border payments for import/export of goods and services for merchants is the PA-CB activity; an unauthorised entity doing it is a violation. Authorised dealer banks and authorised money changers handle FX; MTSS agents handle inward personal remittances.
- **What the product does.** Origin-India flows are fiat only; INR payout through an authorised partner leg; invoice and purpose code mandatory for business receipts; PA-CB per-transaction cap, MTSS count/amount caps, LRS annual cap and purpose-code checks are encoded in `lib/guardrails`; PAN checks via a KYC provider; Aadhaar numbers are never collected; eFIRA/eBRC are requested from issuers, not generated; the grievance officer page exists.
- **Counsel must decide.** (a) Whether Vaulte may *instruct* a PA-CB-authorised partner and take a markup without being a PA-CB itself, or must operate as the partner's technology provider/agent under the partner's authorisation; (b) whether an Indian resident paying INR that funds an offshore stablecoin purchase creates a VDA transfer or LRS issue for that resident (the design tries to keep Indian parties out of any VDA leg, but a tax adviser must confirm; do not market it as "no crypto tax"); (c) data-localisation: which datasets are "payment system data"; (d) GST on Vaulte's markup and the correct invoice wording for exports under LUT (the PDF prints only what the seller types); (e) whether marketplace-style milestone deals involve a regulated collection of funds.

### 3.2 Nepal

- **Regulators and laws.** Nepal Rastra Bank (NRB); Foreign Exchange (Regulation) Act 2019; Payment and Settlement Act 2019 (payment service providers/operators); NRB remittance-company licensing; Asset (Money) Laundering Prevention Act 2008. Cryptocurrency has been declared unlawful by NRB notices (verify current status and enforcement).
- **What probably needs a licence.** Any remittance or payment service in or out of Nepal needs an NRB licence; outward payments by individuals are tightly restricted.
- **What the product does.** Nepal has a country pack for KYC/KYB (PAN/VAT, OCR registration) and a warning in the profile builder. Nepal is **not** enabled for any live money by default; no stablecoin leg may involve a Nepali party.
- **Counsel must decide.** Whether any live corridor is possible (realistically inbound-only through a licensed remitter), and what disclosure Nepali payees need. Keep `NP` out of `LIVE_COUNTRIES` until a licensed local partner is contracted.

### 3.3 European Union (27 member states)

- **Regulators and laws.** National competent authorities (e.g. BaFin, ACPR, DNB, Central Bank of Ireland); PSD2 (Directive 2015/2366) and the forthcoming PSD3/Payment Services Regulation; Transfer of Funds Regulation (2023/1113: includes crypto "travel rule"); MiCA (Regulation 2023/1114: e-money tokens, crypto-asset service providers); AML Directives and the AML Regulation (AMLA from 2027: verify dates); GDPR; Consumer rights rules for distance contracts; EU sanctions.
- **What probably needs a licence.** Executing payments, money remittance, and holding client funds are payment services (authorisation, or agent of an authorised institution). A mere "technical service provider" or "commercial agent" exclusion (PSD2 Art. 3) is narrow and national. Offering exchange/transfer/custody of crypto-assets, including stablecoins that are e-money tokens, needs MiCA authorisation; USDT is not MiCA-compliant in the EU (the product already refuses USDT for EU users).
- **What the product does.** EU country pack (national registry number, VAT ID verified live against VIES, LEI, IBAN); beneficial-owner threshold 25%; sanctions screening (add the EU consolidated list: needs a token, see `docs/LAUNCH.md`); GDPR-oriented privacy text; no custody.
- **Counsel must decide.** (a) Whether to operate through an EU payment institution as its agent/distributor (passporting rules differ per member state); (b) travel-rule data for any stablecoin leg (the partner's duty, but confirm contractually); (c) whether escrow-style milestone deals touching EU parties are a regulated payment service when no agent is used (they are not offered live without a licensed agent); (d) consumer-law pre-contract information duties for individual users.

### 3.4 United States

- **Regulators and laws.** FinCEN (Bank Secrecy Act; money services business registration, 31 CFR 1010.100(ff)); state money-transmitter licensing (most states; "agent of the payee" and "payment processor" exemptions differ widely by state); unlicensed money transmitting is a federal crime (18 U.S.C. 1960); OFAC (strict liability); CFPB Remittance Rule (Regulation E, subpart B: disclosures, cancellation window, error resolution for consumer international transfers); the GENIUS Act (2025) framework for payment stablecoins (verify implementing rules); NYDFS BitLicense if virtual currency business touches New York; state privacy laws.
- **What probably needs a licence.** Accepting money from a payer and transmitting it to a payee is money transmission in most states unless an exemption fits. The "agent of the payee" exemption helps a *seller* collect payments only if its conditions are met; Vaulte's role as a routing layer for many sellers makes this analysis state-specific.
- **What the product does.** US country pack (EIN, W-9 expectations); OFAC SDN screening; no custody; sandbox-only mock partners; disclosures page; remittance quotes show fees and rates before confirmation.
- **Counsel must decide.** (a) Whether Vaulte must register with FinCEN and obtain state licences, or can rely on a licensed partner as principal with Vaulte as a disclosed agent; (b) Regulation E disclosures and receipts for consumer remittances (the product shows quote data but does not generate Reg E-compliant receipts); (c) state-by-state analysis for escrow-like features; (d) which stablecoin activities fall in GENIUS Act scope.

### 3.5 Australia

- **Regulators and laws.** AUSTRAC (AML/CTF Act 2006; remittance service provider registration; 2024-26 reforms: verify); ASIC (Australian financial services licence for non-cash payment facilities and certain digital assets: verify current regime and the proposed digital-asset-platform rules); Privacy Act 1988; sanctions (DFAT).
- **What probably needs a licence.** Remittance dealing requires AUSTRAC registration; a facility for making non-cash payments can need an AFSL; holding client money for others can trigger licensing.
- **What the product does.** Australia country pack (ABN checksum, ACN, BSB|account; live ABN Lookup with a free GUID); no custody.
- **Counsel must decide.** Registration/AFSL perimeter for a routing layer; ABN lookup terms of use; whether milestone deals are a "payment facility".

### 3.6 United Arab Emirates

- **Regulators and laws.** Central Bank of the UAE (Retail Payment Services and Card Schemes Regulation 2021; Payment Token Services Regulation for dirham stablecoins: verify); VARA (Dubai), ADGM FSRA and DIFC DFSA for virtual assets and financial services in their zones; Federal AML law (Decree-Law 20 of 2018) and the UBO register rules; PDPL (Federal Decree-Law 45 of 2021); FTA for VAT (TRN).
- **What probably needs a licence.** Payment services, remittance and virtual-asset services each need a licence from the competent authority; mainland vs free-zone matters.
- **What the product does.** UAE country pack (trade licence number, TRN, free-zone/mainland entity types, Ejari/tenancy proof, UBO list); no custody; AED supported as a currency by partners.
- **Counsel must decide.** Which authority covers each activity, and whether a UAE licensed partner can carry live flows with Vaulte as a technology provider.

### 3.7 Saudi Arabia

- **Regulators and laws.** SAMA (Payment Services Law and implementing regulations: payment service providers need a licence); Capital Market Authority; AML Law 2017; PDPL (in force 2023; cross-border transfer rules); ZATCA (VAT 15%, e-invoicing/FATOORA obligations for sellers: verify applicability); National Address requirement for businesses; crypto is not recognised as legal tender and SAMA has issued warnings (verify).
- **What the product does.** Saudi country pack (Commercial Registration number, VAT number format, National Address proof).
- **Counsel must decide.** Whether a SAMA-licensed partner can run live corridors; ZATCA e-invoice integration if Saudi sellers issue invoices through Vaulte (the PDFs are *not* ZATCA-compliant e-invoices); PDPL transfer conditions.

### 3.8 Malaysia

- **Regulators and laws.** Bank Negara Malaysia (Financial Services Act 2013, Money Services Business Act 2011: remittance and currency-exchange licences; e-money and payment instrument rules; e-KYC policy); Securities Commission (digital assets); AMLA 2001; PDPA 2010 (amended 2024: verify); Companies Commission (SSM) beneficial-ownership reporting.
- **What probably needs a licence.** Remittance business needs an MSB licence; operating a payment system or issuing designated payment instruments needs BNM approval.
- **What the product does.** Malaysia country pack (SSM number, TIN/SST, BIC|account format, local entity types).
- **Counsel must decide.** MSB-licensed partner and agent arrangements; whether Vaulte's markup collection needs its own licence.

### 3.9 United Kingdom

- **Regulators and laws.** FCA (Payment Services Regulations 2017; Electronic Money Regulations 2011; cryptoasset registration under the Money Laundering Regulations 2017 and the new cryptoasset regime being legislated: verify; financial-promotion rules for crypto); OFSI/UK sanctions; UK GDPR and Data Protection Act 2018; Consumer Duty where retail customers are served; PSR for payment-system rules.
- **What probably needs a licence.** Payment services need authorisation or registration as an agent of an authorised firm; holding customer money safeguarded requires authorisation.
- **What the product does.** UK country pack (Companies House number with a live lookup when a free API key is set, VAT, sort code handled for payouts); UK sanctions list included in screening.
- **Counsel must decide.** Agent or authorised-firm route; financial-promotions approval for any crypto-related marketing; Consumer Duty obligations if retail users are onboarded.

### 3.10 Everywhere else

Use the generic pack only for test mode. Do not add a country to `LIVE_COUNTRIES` without a local-law answer to the three questions in section 2.

## 4. Cross-cutting issues

1. **Stablecoin leg.** Travel-rule data, issuer freeze risk, de-peg risk and local bans (EU for USDT; Nepal for all crypto). Contractual allocation of these risks to the partner. The product shows risks on `/legal/disclosures`.
2. **Sanctions.** OFAC, UN and UK lists are loaded daily; EU list is not loaded by default. A sanctions programme also needs a written policy, an appointed officer, training and audit trail; the AML page is a summary only. Decide how to treat jurisdictions that are sanctioned by one regime but not another.
3. **Data protection.** Roles (Vaulte as controller for accounts; processor or joint controller for guests who pay or approve deals); cross-border transfer mechanisms; processor agreements with partners and registry providers; DPIA for KYC data; breach notification workflow; retention periods by country (commonly five years or more after the relationship ends); data residency for India.
4. **Consumer protection.** Individuals using the personal-remittance lane are consumers in most countries: pre-transaction disclosures, cancellation and refund rights, complaint handling and ADR schemes vary. The product shows fees, rates and delivery estimates but does not yet generate country-specific regulated receipts.
5. **Escrow.** Holding money for others is a licensed activity almost everywhere. The product therefore (a) uses only a licensed agent for held funds and (b) calls the other mode what it is. Counsel must approve the agent contract, how disputes are decided and communicated, and whether the staff dispute decision could itself be a regulated activity.
6. **Invoices and tax.** Invoices carry whatever tax particulars the seller enters. E-invoicing mandates (India GST e-invoice, Saudi ZATCA, EU country mandates) are **not** implemented: sellers subject to them must use their own compliant system. Proforma invoices are labelled "not a tax invoice".
7. **Certificates.** eFIRA, FIRC, eBRC and bank certificates come from banks, partners or DGFT. The product requests and stores them and never fabricates one.
8. **Records.** Keep financial, KYC and communications records for the longest applicable period; confirm deletion rules against retention duties.
9. **Terms and consumer law.** Liability caps, governing law, arbitration, unfair-terms rules and language requirements differ per country. The terms contain explicit `[COUNSEL]` placeholders; do not remove them without a lawyer.
10. **Complaints.** The grievance page must name a real officer, response times and escalation routes per jurisdiction (e.g. RBI Ombudsman for Indian payment systems, FOS in the UK, national ADR bodies in the EU).

## 5. Launch gates mapped to controls

| Gate | Control in the product |
|---|---|
| Written answers to section 2 for each launch country | `LIVE_COUNTRIES` allowlist; preflight blocks if unset |
| Executed contracts with licensed partners (and escrow agent if offered) | `PARTNER_CATALOG_JSON` / `PARTNER_CATALOG_FILE`; live escrow disabled until an adapter is registered |
| Counsel-approved legal texts | `LEGAL_REVIEWED=true`; company details env vars; Terms version bump forces user re-acceptance |
| Compliance officer, AML programme, sanctions procedures | AML page is a summary; staff queues, two-person EDD approval and audit logs exist |
| Real KYC provider and live registry keys | `KYC_PROVIDER`, `COMPANIES_HOUSE_API_KEY`, `ABN_LOOKUP_GUID` |
| Partner webhooks and signatures verified live | smoke scripts under `scripts/`; unverified items are listed in `docs/LAUNCH.md` |
| Data hosting and storage in required regions | `DATA_REGION`, `S3_*`; India payment data in India |

## 6. Questions for each counsel

**Everyone (global counsel):** answers to the three questions in section 2; marketing-claims review; group structure (which entity contracts with partners and customers); insurance (professional indemnity, cyber, crime); board and officer responsibilities.

**India:** PA-CB or technology-provider-of-an-authorised-entity; MTSS agent status for inward personal remittances; LRS and TCS treatment for users; VDA tax and TDS exposure of any Indian party in a stablecoin route; GST on markup; data localisation; DPDP roles and notices; RBI grievance obligations; whether pay-on-approval and escrow-style deals need separate permissions.

**Nepal:** whether any live corridor is lawful and through whom; any prohibition on a foreign platform facilitating payments to Nepali residents.

**EU/UK:** agent or authorised-firm route; MiCA and travel-rule allocation; passporting; safeguarding; financial promotions; consumer information duties; GDPR transfer tools for partners outside the EEA.

**US:** FinCEN registration; state licences or exemptions (list the states you will serve); Regulation E receipts; OFAC compliance programme; GENIUS Act scope; state escrow and privacy laws.

**Australia:** AUSTRAC registration; AFSL; ABN Lookup terms.

**UAE / Saudi Arabia / Malaysia:** licensing authority for each activity; local partner structure; local-language terms; e-invoicing (Saudi); data transfer conditions.

## 7. What I could not verify from here

- Every statutory citation, threshold and date above (no live legal research was possible).
- Whether any partner will contract with Vaulte on the proposed structure.
- The behaviour of Airwallex, Currencycloud, Wise, Sandbox.co.in, QuickBooks, Zoho, Xero and Tally against their real APIs (contract-tested against local stubs only; `scripts/*-smoke.mjs` run them with your keys). EU VIES and GLEIF were verified live.
