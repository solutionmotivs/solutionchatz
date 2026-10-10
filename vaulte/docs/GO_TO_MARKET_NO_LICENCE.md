# Starting without a licence: what to do now, what never to say or do

> **Update (Round 3).** This note describes the test-mode start. The longer-term target is not "pilot only": it is the **licensed-principal (agent) model** in `AGENT_MODEL_MEMO.md`, where a licensed partner is the provider of record and holds the money, and Vaulte runs onboarding, orchestration and the customer experience. The pricing model is in `PRICING.md`. Nothing here changes the rule that no live money moves until counsel clears a country and the partner has approved the customer.

Decision (yours): **no licence for now.** Goal: a good start and gathering clients. This note keeps that honest and safe. Not legal advice: counsel confirms it for each country before any real money.

## What Vaulte is in this phase

A **software platform and test-mode pilot**: quotes, route comparison, invoices, KYC/KYB workflow, sanctions and HS checks, certificates and statements, run against **simulated partners**. **No real money moves through it, and Vaulte holds no funds.** Live payments, later, go only through licensed partners, one counsel-cleared corridor at a time (`LIVE_COUNTRIES`).

## What you can do now

1. **Show the demo** (`https://vaulte-demo.onrender.com`, banner says test mode) and the new **pilot form** (`/pilot`). Leads land in `/admin/leads` with a pipeline: NEW, CONTACTED, PILOT, PAUSED, CLOSED. Consent is recorded.
2. **Run test-mode pilots**: a customer enters real invoices (fake amounts) and sees quotes, HS checks, KYB steps, certificate requests and statements.
3. **Collect what customers need**: corridors, monthly volume, currencies, whether they want stablecoin at all (many will prefer plain bank transfer), required certificates (eFIRA, eBRC).
4. **Sign non-binding letters of interest** that are explicitly conditional on partner approval and legal clearance.
5. **Introduce customers to licensed partners** once a partner is chosen: the customer contracts with the partner for live money, and Vaulte earns a referral or software fee agreed with the partner or customer. **Confirm with counsel which fee model is safe in each country** before invoicing one.
6. **Use the waiting time** for the partner sandboxes (`PARTNER_SETUP.md`), so the first live corridor is ready the day counsel clears it.

## What never to do or say

- Never say or imply Vaulte is **licensed, regulated, authorised** or "a bank / remittance company / payment provider". Say "technology platform; payments through licensed partners."
- Never say "we send your money", "we hold your money", "instant" or "under 24 hours" as a guarantee. Say "target" and quote measured times once they exist.
- Never take, hold or pass customer money, even briefly, even "just for the pilot". No pooled accounts, no personal accounts, no wallets.
- Never accept real payments on the demo. It is test mode with fake partners; the login code is shown on screen by design.
- Never promise or market crypto to Indian parties. The Indian side is fiat only.
- Never market in a country counsel has not cleared, or to sanctioned places (Iran, North Korea, Syria, Cuba; Russia and Belarus are closed).
- Never use a partner's name or logo as an endorsement without its written permission.
- Never quote a price you cannot back: say "from the partner's live quote plus Vaulte's published markup".

## What to say (copy)

English: "Vaulte is a technology platform for cross-border business payments. Today you can try it in test mode. When we go live, payments are carried out by licensed partners in each country, and we will tell you plainly which corridors are open. Vaulte never holds your funds."

Hindi: "Vaulte cross-border business payments ke liye ek technology platform hai. Abhi aap ise test mode mein aazma sakte hain. Live hone par har desh mein payments licensed partners karenge, aur hum saaf bataenge ki kaunse corridor khule hain. Vaulte aapka paisa kabhi apne paas nahi rakhta."

## Four-week start

| Week | Do | Measure |
|---|---|---|
| 1 | 20 outreach messages to exporters and importers in one corridor (suggest US to India); share `/pilot` | leads in NEW |
| 2 | 10 discovery calls: corridor, volume, certificates, stablecoin or not; add notes in `/admin/leads` | leads in CONTACTED |
| 3 | 3 to 5 test-mode pilots with their real invoices; record what they miss | pilots in PILOT; list of gaps |
| 4 | Pick the first corridor from the demand; collect partner sandbox keys; send the partner questions in `ARCHITECTURE_PLAN.md`; keep the LOI list | LOIs; partner answers |

## Data you now collect (DPDP/GDPR)

The pilot form stores name, work email, company, country, role, corridor, volume band, use case and the consent time. Use it only to contact the person about the pilot; delete on request; do not buy or scrape lists; send nothing marketing-like beyond the pilot without consent. Your privacy notice (`/legal/privacy`) must name the company and contact (`COMPANY_*` settings are still unset).

## What would force a licence conversation sooner

A customer asking Vaulte to **receive or hold** their money; Vaulte **choosing the beneficiary or initiating** payments on a customer's behalf in the EU/UK (payment-initiation rules); taking the **FX margin itself** instead of the partner; or any live pilot with real money. Stop and ask counsel first.
