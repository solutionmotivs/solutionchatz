// Free / low-cost official sources first. Each adapter maps "source down" to UNAVAILABLE so a flaky registry never rejects a customer.
import { euVatNumber, isEuCountry, normalise } from "../validators";
import { nowIso, type RegistryAdapter, type RegistryCode, type RegistryRecord } from "./types";

async function getJson(url: string, init: RequestInit = {}, ms = 10_000): Promise<{ status: number; json: any }> {
  const res = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(ms) });
  let json: any = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { const m = text.match(/^[\w$.]*\((.*)\)\s*;?\s*$/s); if (m) { try { json = JSON.parse(m[1]); } catch {} } }
  return { status: res.status, json };
}
const unavailable = (source: string, sourceUrl: string, reason: string): RegistryRecord => ({ status: "UNAVAILABLE", source, sourceUrl, details: {}, reason, checkedAt: nowIso() });
const guard = async (source: string, sourceUrl: string, f: () => Promise<RegistryRecord>): Promise<RegistryRecord> => {
  try { return await f(); } catch (e) { return unavailable(source, sourceUrl, e instanceof Error ? e.message : "lookup failed"); }
};

/** EU VAT Information Exchange System (European Commission). Free; each member state can be temporarily unavailable. */
export class ViesAdapter implements RegistryAdapter {
  readonly id = "vies";
  private url = "https://ec.europa.eu/taxation_customs/vies/";
  constructor(private base = process.env.VIES_BASE_URL ?? "https://ec.europa.eu/taxation_customs/vies/rest-api") {}
  configured() { return true; }
  supports(code: RegistryCode, country: string) { return code === "VAT_ID" && (isEuCountry(country) || country === "XI"); }
  lookup(_c: RegistryCode, value: string, country: string) {
    return guard(this.id, this.url, async () => {
      const prefix = country === "GR" ? "EL" : country;
      const num = euVatNumber(country, value);
      const { status, json } = await getJson(`${this.base}/ms/${prefix}/vat/${encodeURIComponent(num)}`);
      if (status !== 200 || !json) return unavailable(this.id, this.url, `VIES HTTP ${status}`);
      // userError carries the real outcome: INVALID is a genuine "no"; MS_UNAVAILABLE / MS_MAX_CONCURRENT_REQ / TIMEOUT are "try later".
      const ue = String(json.userError ?? "VALID");
      if (json.isValid === true) {
        const clean = (s: unknown) => (typeof s === "string" && s !== "---" ? s.replace(/\s*\n\s*/g, ", ").trim() : undefined);
        return { status: "FOUND", source: this.id, sourceUrl: this.url, legalName: clean(json.name), address: clean(json.address), active: true, details: { vat_number: `${prefix}${num}`, request_identifier: json.requestIdentifier || undefined }, checkedAt: nowIso() };
      }
      if (ue === "INVALID" || ue === "VALID") return { status: "NOT_FOUND", source: this.id, sourceUrl: this.url, details: {}, reason: "VAT number is not registered in VIES", checkedAt: nowIso() };
      return unavailable(this.id, this.url, `VIES: ${ue}`);
    });
  }
}

/** GLEIF Global LEI Index (free, global). */
export class GleifAdapter implements RegistryAdapter {
  readonly id = "gleif";
  private url = "https://www.gleif.org/en/lei-data/gleif-concatenated-file";
  constructor(private base = process.env.GLEIF_BASE_URL ?? "https://api.gleif.org/api/v1") {}
  configured() { return true; }
  supports(code: RegistryCode) { return code === "LEI"; }
  lookup(_c: RegistryCode, value: string, _country?: string) {
    return guard(this.id, this.url, async () => {
      const { status, json } = await getJson(`${this.base}/lei-records/${encodeURIComponent(normalise(value))}`);
      if (status === 404) return { status: "NOT_FOUND", source: this.id, sourceUrl: this.url, details: {}, reason: "LEI not found", checkedAt: nowIso() };
      if (status !== 200 || !json?.data) return unavailable(this.id, this.url, `GLEIF HTTP ${status}`);
      const a = json.data.attributes, e = a.entity ?? {}, ad = e.legalAddress ?? {};
      return {
        status: "FOUND", source: this.id, sourceUrl: this.url, legalName: e.legalName?.name,
        address: [...(ad.addressLines ?? []), ad.city, ad.postalCode, ad.country].filter(Boolean).join(", "),
        active: e.status === "ACTIVE" && a.registration?.status === "ISSUED",
        details: { lei: a.lei, entity_status: e.status, registration_status: a.registration?.status, jurisdiction: e.jurisdiction, legal_form: e.legalForm?.other ?? e.legalForm?.id, registered_as: e.registeredAs, next_renewal: a.registration?.nextRenewalDate },
        checkedAt: nowIso(),
      };
    });
  }
}

/** UK Companies House (free key from developer.company-information.service.gov.uk). */
export class CompaniesHouseAdapter implements RegistryAdapter {
  readonly id = "companies_house";
  private url = "https://find-and-update.company-information.service.gov.uk/";
  constructor(private key = process.env.COMPANIES_HOUSE_API_KEY, private base = process.env.COMPANIES_HOUSE_BASE_URL ?? "https://api.company-information.service.gov.uk") {}
  configured() { return !!this.key; }
  supports(code: RegistryCode, country: string) { return code === "REG_NO" && country === "GB"; }
  lookup(_c: RegistryCode, value: string, _country?: string) {
    return guard(this.id, this.url, async () => {
      if (!this.key) return unavailable(this.id, this.url, "Companies House key not configured");
      const { status, json } = await getJson(`${this.base}/company/${encodeURIComponent(normalise(value))}`, { headers: { Authorization: "Basic " + Buffer.from(`${this.key}:`).toString("base64") } });
      if (status === 404) return { status: "NOT_FOUND", source: this.id, sourceUrl: this.url, details: {}, reason: "Company number not found at Companies House", checkedAt: nowIso() };
      if (status !== 200 || !json) return unavailable(this.id, this.url, `Companies House HTTP ${status}`);
      const ad = json.registered_office_address ?? {};
      return {
        status: "FOUND", source: this.id, sourceUrl: this.url, legalName: json.company_name,
        address: [ad.address_line_1, ad.address_line_2, ad.locality, ad.postal_code, ad.country].filter(Boolean).join(", "),
        active: json.company_status === "active",
        details: { company_status: json.company_status, type: json.type, date_of_creation: json.date_of_creation, sic_codes: json.sic_codes, has_insolvency_history: json.has_insolvency_history },
        checkedAt: nowIso(),
      };
    });
  }
}

/** Australian Business Register ABN Lookup (free GUID from abr.business.gov.au/Tools/WebServices). */
export class AbnLookupAdapter implements RegistryAdapter {
  readonly id = "abn_lookup";
  private url = "https://abr.business.gov.au/";
  constructor(private guid = process.env.ABN_LOOKUP_GUID, private base = process.env.ABN_LOOKUP_BASE_URL ?? "https://abr.business.gov.au/json") {}
  configured() { return !!this.guid; }
  supports(code: RegistryCode, country: string) { return code === "ABN" && country === "AU"; }
  lookup(_c: RegistryCode, value: string, _country?: string) {
    return guard(this.id, this.url, async () => {
      if (!this.guid) return unavailable(this.id, this.url, "ABN Lookup GUID not configured");
      const { status, json } = await getJson(`${this.base}/AbnDetails.aspx?abn=${encodeURIComponent(value.replace(/\s/g, ""))}&guid=${encodeURIComponent(this.guid)}&callback=cb`);
      if (status !== 200 || !json) return unavailable(this.id, this.url, `ABN Lookup HTTP ${status}`);
      if (json.Message) return /not (a )?valid|no records|search text is not/i.test(json.Message) ? { status: "NOT_FOUND", source: this.id, sourceUrl: this.url, details: {}, reason: String(json.Message), checkedAt: nowIso() } : unavailable(this.id, this.url, String(json.Message));
      const active = String(json.AbnStatus ?? "").toLowerCase() === "active";
      return {
        status: "FOUND", source: this.id, sourceUrl: this.url, legalName: json.EntityName || json.BusinessName?.[0], address: [json.AddressState, json.AddressPostcode, "AU"].filter(Boolean).join(" "), active,
        details: { abn_status: json.AbnStatus, entity_type: json.EntityTypeName, gst_registered_from: json.Gst || undefined, acn: json.Acn || undefined, business_names: json.BusinessName },
        checkedAt: nowIso(),
      };
    });
  }
}

export function defaultAdapters(): RegistryAdapter[] {
  return [new ViesAdapter(), new GleifAdapter(), new CompaniesHouseAdapter(), new AbnLookupAdapter()];
}
