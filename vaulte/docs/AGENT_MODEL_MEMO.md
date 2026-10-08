# The licensed-principal ("agent") model: how Vaulte runs without its own licence

Status: October 2026. **Written for counsel to confirm, country by country. Not legal advice.** Citations and thresholds below are my reading of public material and must be checked against the current text and the local regulator before anyone relies on them.

## The model in one paragraph

Vaulte is the customer's service: sign-up, KYC/KYB, invoices, quotes, instructions, documents. **A licensed partner is the regulated provider of record**: it holds the customer's money (in a sub-account in the customer's name, or in its own safeguarded account), converts it and pays it out. Vaulte earns its fee from the partner (a share) and never holds, pools or passes customer funds. Where a country requires it, Vaulte is **registered or notified as the partner's agent** (a registration, not a licence of its own).

## Who does what

| Step | Vaulte | Licensed partner |
|---|---|---|
| Customer sign-up, KYC/KYB collection and checks | Runs it (registries, document checks, sanctions, risk tier) | Receives Vaulte's verified package and **decides** whether to accept the customer |
| Quote | Shows the partner's live price plus its own fee, split on screen | Provides the firm rate |
| Instruction | Takes the customer's instruction and sends it | Executes only for customers it has approved |
| Money | **Never touches it** | Receives, holds, converts, pays out |
| Certificates (eFIRA/FIRC/eBRC) | Collects, stores and links them | Issues them (or its bank does) |
| Vaulte's fee | Invoiced to the partner as a revenue share | Deducts it from the payment and remits it (`FEE_COLLECTION=PARTNER_SHARE`) |

## What the code enforces (and where)

1. **Principal of record on every live leg** (`lib/routing/structure.ts`): `principal` (the partner itself), `fundsHeldBy: "PARTNER"`, `accountHolder: CUSTOMER_SUBACCOUNT | PARTNER_SAFEGUARDED`, `vaulteRole: AGENT | TECH_PROVIDER`, `agreementRef`. A catalogue leg without them does not load; Vaulte-owned or pooled accounts are rejected. Live FX providers need an entry in `PARTNER_STRUCTURE_JSON`.
2. **Delegated onboarding** (`lib/partners/customers.ts`, table `PartnerCustomer`): live money moves through a partner only when it has approved that customer (`APPROVED`). Partners with an API get Vaulte's package automatically; others are marked by staff after the partner confirms (`/api/admin/partner-customers`). Test mode uses sandbox partners that auto-approve so you can see the flow.
3. **Agent registration gate**: routes where `vaulteRole` is `AGENT` stay closed for customers in a country until `AGENT_REGISTRATION_<CC>=confirmed` (or `not_required`, with counsel's written view). `LIVE_COUNTRIES` still decides which countries are open at all. `node scripts/preflight.mjs` fails on all of these.
4. **India fiat only** (`assertIndiaFiatOnly`): no token, chain, on-ramp or off-ramp leg in India, ever.

## Why "no licence" cannot be promised by code

- A platform that onboards customers, instructs payments and takes a margin is often treated as a payment-service **agent or distributor**. That is normally lawful **under a licensed principal**, with the principal registering or notifying the agent. It is not the same as being outside regulation.
- **EU/UK (PSD2 and the UK Payment Services Regulations).** As I read it, the technical-service-provider exclusion does not cover payment **initiation**; the usual route is to act as an agent of an authorised payment institution (the institution registers the agent with its regulator) or to be authorised. The "commercial agent" exclusion is narrow and risky when acting for both payer and payee. **Counsel to confirm for each member state and the UK.**
- **US.** Money-transmission rules are state by state and federal (FinCEN). Agent-of-a-licensee arrangements exist in some states and not others. **Counsel to confirm per state and per product.**
- **India.** Receiving foreign-currency export payments and paying out INR is for RBI-authorised payment aggregators for cross-border (PA-CB) or AD banks; the transaction cap per payment is ₹25 lakh at the time of writing. Vaulte would be the PA-CB's technology and onboarding front end, not the authorised entity. **Counsel to confirm how RBI treats the onboarding and fee arrangement.**
- **UAE, Singapore.** Local licensing (CBUAE/VARA/ADGM, MAS Payment Services Act) is entity-based; agent and referral arrangements vary. **Counsel to confirm.**

## Questions to put to every partner (write the answers down)

1. Are you the regulated provider of record for this flow, in which countries, under which licence numbers (we will check each on the regulator's register)?
2. Who is the account holder: a sub-account in the customer's name, or your safeguarded account? Is the money ever in an account owned by Vaulte? (It must not be.)
3. May we run KYC/KYB under your programme and send you the result? What do you require beyond it? How long does your approval take, and by API or by email?
4. Are we required to be registered or notified as your agent in each country? Will you do the filing? Cost and timeline?
5. May Vaulte take a fee on top, and how is it paid: do you deduct it and remit it, per transfer or monthly? Is that permitted by your licence and by local rules?
6. Settlement times per rail and cut-offs; certificates (eFIRA/FIRC/eBRC): who issues them and how are they delivered?
7. Sandbox, webhook signing, idempotency, limits per transfer, and what you need from us when a transfer is held.

## What Vaulte should not do under this model

- Receive or hold customer money, even briefly or "for the pilot".
- Choose a beneficiary or amount for a customer (instructions come from the customer).
- Describe itself as licensed, authorised or regulated, or as sending the money.
- Open a country live before the partner has approved the customer and counsel has cleared the country.

## Open items for counsel

A written view per country on: (a) agent registration needed or not, (b) whether Vaulte's fee may be paid by the partner out of the customer's payment, (c) whether Vaulte's onboarding of customers for the partner is permitted, (d) the wording of customer terms (the customer contracts with the partner for the payment service), (e) data-protection roles (Vaulte and partner as controllers or joint controllers).
