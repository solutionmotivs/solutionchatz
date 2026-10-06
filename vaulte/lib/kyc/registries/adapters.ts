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

/**
 * Keyless national open-data registers (government-run, verified reachable and parsed in October 2026):
 * France (INSEE SIRENE via recherche-entreprises.api.gouv.fr), Norway (Bronnoysund), Czechia (ARES),
 * Singapore (ACRA via data.gov.sg), Estonia (e-Business Register). Each maps "source down" to UNAVAILABLE.
 */
const digits = (v: string) => v.replace(/\D/g, "");
interface NationalSpec { country: string; id: string; source: string; url: string; valid: (v: string) => boolean; fetch: (v: string, base?: string) => Promise<RegistryRecord> }
const found = (spec: Pick<NationalSpec, "id" | "url">, r: Omit<RegistryRecord, "source" | "sourceUrl" | "checkedAt">): RegistryRecord => ({ ...r, source: spec.id, sourceUrl: spec.url, checkedAt: nowIso() });
const notFound = (spec: Pick<NationalSpec, "id" | "url">, reason: string): RegistryRecord => found(spec, { status: "NOT_FOUND", details: {}, reason });

export const NATIONAL_REGISTRIES: NationalSpec[] = [
  {
    country: "FR", id: "fr_sirene", source: "INSEE SIRENE", url: "https://annuaire-entreprises.data.gouv.fr/", valid: v => /^\d{9}$/.test(digits(v)),
    async fetch(v, base = process.env.FR_SIRENE_BASE_URL ?? "https://recherche-entreprises.api.gouv.fr") {
      const n = digits(v); const { status, json } = await getJson(`${base}/search?q=${n}&per_page=1`);
      if (status !== 200 || !json) return unavailable(this.id, this.url, `SIRENE HTTP ${status}`);
      const r = (json.results ?? []).find((x: any) => x.siren === n);
      // For an unknown SIREN the API echoes a placeholder entry with no name, so a name is required to count as found.
      if (!r || !(r.nom_raison_sociale || r.nom_complet)) return notFound(this, "SIREN not found in the French business register");
      return found(this, { status: "FOUND", legalName: r.nom_raison_sociale || r.nom_complet, address: r.siege?.adresse, active: r.etat_administratif === "A", details: { siren: n, legal_form_code: r.nature_juridique, created: r.date_creation, administrative_status: r.etat_administratif } });
    },
  },
  {
    country: "NO", id: "no_brreg", source: "Bronnoysund Register Centre", url: "https://www.brreg.no/", valid: v => /^\d{9}$/.test(digits(v)),
    async fetch(v, base = process.env.NO_BRREG_BASE_URL ?? "https://data.brreg.no/enhetsregisteret/api") {
      const n = digits(v); const { status, json } = await getJson(`${base}/enheter/${n}`);
      if (status === 404) return notFound(this, "Organisation number not found in Enhetsregisteret");
      if (status !== 200 || !json) return unavailable(this.id, this.url, `Brreg HTTP ${status}`);
      const a = json.forretningsadresse ?? {};
      return found(this, { status: "FOUND", legalName: json.navn, address: [...(a.adresse ?? []), a.postnummer, a.poststed, a.land].filter(Boolean).join(", "), active: !json.konkurs && !json.underAvvikling && !json.slettedato, details: { org_number: n, legal_form: json.organisasjonsform?.kode, founded: json.stiftelsesdato, bankrupt: !!json.konkurs, under_liquidation: !!json.underAvvikling } });
    },
  },
  {
    country: "CZ", id: "cz_ares", source: "ARES (Czech Ministry of Finance)", url: "https://ares.gov.cz/", valid: v => /^\d{8}$/.test(digits(v)),
    async fetch(v, base = process.env.CZ_ARES_BASE_URL ?? "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest") {
      const n = digits(v); const { status, json } = await getJson(`${base}/ekonomicke-subjekty/${n}`);
      if (status === 404) return notFound(this, "ICO not found in ARES");
      if (status !== 200 || !json) return unavailable(this.id, this.url, `ARES HTTP ${status}`);
      return found(this, { status: "FOUND", legalName: json.obchodniJmeno, address: json.sidlo?.textovaAdresa, active: !json.datumZaniku, details: { ico: n, legal_form_code: json.pravniForma, created: json.datumVzniku, ended: json.datumZaniku } });
    },
  },
  {
    country: "SG", id: "sg_acra", source: "ACRA via data.gov.sg", url: "https://data.gov.sg/", valid: v => /^[0-9]{8,9}[A-Za-z]$|^[TSRtsr]\d{2}[A-Za-z]{2}\d{4}[A-Za-z]$/.test(v.replace(/\s/g, "")),
    async fetch(v, base = process.env.SG_DATAGOV_BASE_URL ?? "https://data.gov.sg/api/action") {
      const uen = v.replace(/\s/g, "").toUpperCase();
      const { status, json } = await getJson(`${base}/datastore_search?resource_id=d_3f960c10fed6145404ca7b821f263b87&filters=${encodeURIComponent(JSON.stringify({ uen }))}&limit=1`);
      if (status !== 200 || !json?.success) return unavailable(this.id, this.url, `data.gov.sg HTTP ${status}`);
      const r = json.result?.records?.[0];
      if (!r) return notFound(this, "UEN not found in the ACRA register");
      return found(this, { status: "FOUND", legalName: r.entity_name, address: [r.reg_street_name, r.reg_postal_code, "SG"].filter(Boolean).join(", "), active: /registered|live/i.test(String(r.uen_status_desc)), details: { uen, entity_type: r.entity_type_desc, status: r.uen_status_desc, issued: r.uen_issue_date, agency: r.issuance_agency_desc } });
    },
  },
  {
    country: "EE", id: "ee_rik", source: "e-Business Register (RIK)", url: "https://ariregister.rik.ee/", valid: v => /^\d{8}$/.test(digits(v)),
    async fetch(v, base = process.env.EE_RIK_BASE_URL ?? "https://ariregister.rik.ee/est/api") {
      const n = digits(v); const { status, json } = await getJson(`${base}/autocomplete?q=${n}`);
      if (status !== 200 || !json) return unavailable(this.id, this.url, `RIK HTTP ${status}`);
      const r = (json.data ?? []).find((x: any) => String(x.reg_code) === n);
      if (!r) return notFound(this, "Registry code not found in the Estonian e-Business Register");
      return found(this, { status: "FOUND", legalName: r.name, address: [r.legal_address, r.zip_code].filter(Boolean).join(", "), active: r.status === "R", details: { reg_code: n, status_code: r.status, legal_form: r.legal_form } });
    },
  },
];

export class NationalRegistryAdapter implements RegistryAdapter {
  readonly id: string;
  constructor(private spec: NationalSpec) { this.id = spec.id; }
  configured() { return true; }
  supports(code: RegistryCode, country: string) { return code === "REG_NO" && country === this.spec.country; }
  lookup(_c: RegistryCode, value: string, _country?: string) {
    return guard(this.spec.id, this.spec.url, async () => {
      if (!this.spec.valid(value)) return notFound(this.spec, `Not a valid ${this.spec.source} number format`);
      return this.spec.fetch(value);
    });
  }
}

export function defaultAdapters(): RegistryAdapter[] {
  return [new ViesAdapter(), new GleifAdapter(), new CompaniesHouseAdapter(), new AbnLookupAdapter(), ...NATIONAL_REGISTRIES.map(s => new NationalRegistryAdapter(s))];
}
