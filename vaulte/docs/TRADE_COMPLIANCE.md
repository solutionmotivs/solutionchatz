# HS codes and trade compliance

## What is built

- **HS 2022 search and validation**: `GET /api/hs?q=cotton trousers` (or `?q=6203`), `GET /api/hs/6203.42`. Data: the open Harmonized System 2022 dataset (2-, 4-, 6-digit levels; ODC-PDDL-1.0, derived from UN Comtrade), vendored in `data/hs2022.csv` with its source in `data/README-hs.md`. The HS is maintained by the WCO; this is a convenience copy, not an official publication.
- **On invoices**: every line can carry an `hs_code` (dashboard autocomplete, API and hosted checkout). Codes are normalised to digits and validated against HS 2022. For goods purposes (**P01xx**) every line **must** have a code of at least 6 digits (`HS_CODE_REQUIRED`). The code prints on the invoice PDF.
- **8-10 digit national codes** (for example India's ITC-HS) are accepted only when their first six digits exist in HS 2022, and are flagged `national_extension_unchecked`: the national extension is DGFT/CBIC data that is not in the open dataset. If you need it verified, supply DGFT's ITC-HS list and extend `lib/trade/hs.ts`.
- **Trade-risk rules** (`lib/trade/risk.ts`), deliberately small and conservative:
  - **PROHIBITED** (invoice and transfer refused, error `HS_PROHIBITED`): arms and ammunition (chapter 93), radioactive/nuclear (2844, 2845, 8401), explosives (chapter 36). These mirror the Acceptable Use policy.
  - **REVIEW** (the transfer is held after the funds are confirmed and before any payout, as `QUARANTINED: TRADE_REVIEW: <codes>`; staff release or reject with a note, and a released transfer is not held again): precious metals/stones/jewellery (71), certain plants and extracts, organic chemicals/pesticides that can be precursors, alcohol and tobacco, aircraft/space, and dual-use-prone computing, telecoms, radar/navigation and optics headings.
  - This is **not an export-control classification**. Dual-use control lists are defined by technical specification, not by HS heading; a REVIEW flag is a prompt for a human to check the licence, end user and destination.
- **Sanctions** screening of people, companies and wallets is separate and automatic (OFAC, UN, UK lists; daily sync and re-screen; see `docs/OPERATIONS.md`). Country closures (RU, BY) and currency closures (RUB and others) apply in every mode.

## Not built

Tariff/duty look-ups, rules of origin, per-country import-licence requirements, and customs filing. Purpose codes are not inferred from HS codes (RBI purpose-code selection stays with the customer; use a P01xx code for goods).
