// KYC services on top of API Setu: CKYC two-step (search sends an OTP to the holder's registered mobile, download needs it),
// AML/PEP screening, and KYC OCR with an image-quality gate. A deterministic mock backs development and tests (never production).
import { createHash } from "crypto";
import { apisetuFromEnv, type ApisetuClient } from "./client";

export interface CkycStart { status: "OTP_SENT" | "NOT_FOUND" | "UNAVAILABLE"; referenceId?: string; ckycMasked?: string; reason?: string }
export interface CkycRecord { status: "VERIFIED" | "FAILED" | "UNAVAILABLE"; name?: string; dob?: string; ckycMasked?: string; reason?: string; details: Record<string, unknown> }
export interface PepResult { status: "CLEAR" | "REVIEW" | "UNAVAILABLE"; pep: boolean; sanctioned: boolean; adverseMedia: boolean; matches: { name: string; category: string; list?: string; score?: number }[]; reason?: string }
export interface OcrResult {
  status: "OK" | "POOR_QUALITY" | "UNAVAILABLE";
  fields: { name?: string; dob?: string; idNumberMasked?: string; expiry?: string; docKind?: string };
  quality: { score: number; issues: string[] };
  reason?: string;
}

export interface KycServices {
  readonly name: string;
  ckycSearch(i: { idType: "PAN" | "PASSPORT" | "VOTER" | "DL" | "CKYC"; idNumber: string; dob?: string }): Promise<CkycStart>;
  ckycDownload(i: { referenceId: string; otp: string }): Promise<CkycRecord>;
  amlPep(i: { name: string; dob?: string; country?: string; kind: "INDIVIDUAL" | "ENTITY" }): Promise<PepResult>;
  ocr(i: { docType: string; data: Buffer; mime: string }): Promise<OcrResult>;
}

const maskId = (s: string) => (s.length <= 4 ? "*".repeat(s.length) : "*".repeat(Math.min(s.length - 4, 12)) + s.slice(-4));
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const pick = (o: any, ...keys: string[]) => { for (const k of keys) { const v = k.split(".").reduce((a, p) => a?.[p], o); if (v !== undefined && v !== null && v !== "") return v; } return undefined; };

export class ApisetuServices implements KycServices {
  readonly name = "apisetu";
  constructor(private c: ApisetuClient) {}

  async ckycSearch(i: { idType: string; idNumber: string; dob?: string }): Promise<CkycStart> {
    try {
      const r = await this.c.post(this.c.paths.ckycSearch, { id_type: i.idType, id_number: i.idNumber, date_of_birth: i.dob });
      const ref = s(pick(r, "referenceId", "reference_id", "data.referenceId", "txnId", "transaction_id"));
      const found = pick(r, "found", "data.found", "status") !== false && !/not.?found/i.test(String(pick(r, "status", "message") ?? ""));
      if (!found) return { status: "NOT_FOUND", reason: "No CKYC record for this identifier" };
      if (!ref) return { status: "UNAVAILABLE", reason: "CKYC search returned no reference id" };
      return { status: "OTP_SENT", referenceId: ref, ckycMasked: s(pick(r, "ckycNumberMasked", "ckyc_number_masked", "data.ckycNumberMasked")) };
    } catch (e) { return { status: "UNAVAILABLE", reason: e instanceof Error ? e.message : "CKYC unavailable" }; }
  }

  async ckycDownload(i: { referenceId: string; otp: string }): Promise<CkycRecord> {
    try {
      const r = await this.c.post(this.c.paths.ckycDownload, { reference_id: i.referenceId, otp: i.otp });
      const name = s(pick(r, "fullName", "full_name", "name", "data.fullName", "data.name"));
      if (!name) return { status: "FAILED", reason: s(pick(r, "message")) ?? "CKYC download returned no record", details: {} };
      const ck = s(pick(r, "ckycNumber", "ckyc_number", "data.ckycNumber"));
      return { status: "VERIFIED", name, dob: s(pick(r, "dob", "dateOfBirth", "date_of_birth", "data.dob")), ckycMasked: ck ? maskId(ck) : undefined, details: { gender: s(pick(r, "gender", "data.gender")), source: "CKYC" } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "CKYC unavailable";
      return { status: /invalid.*otp|otp.*invalid|HTTP_4(00|01)/i.test(msg) ? "FAILED" : "UNAVAILABLE", reason: msg, details: {} };
    }
  }

  async amlPep(i: { name: string; dob?: string; country?: string; kind: string }): Promise<PepResult> {
    try {
      const r = await this.c.post(this.c.paths.amlPep, { name: i.name, date_of_birth: i.dob, country: i.country ?? "IN", entity_type: i.kind });
      const raw: any[] = pick(r, "matches", "data.matches", "results", "data.results") ?? [];
      const matches = raw.map(m => ({ name: String(m.name ?? m.matchedName ?? ""), category: String(m.category ?? m.type ?? "UNKNOWN").toUpperCase(), list: s(m.list ?? m.source), score: typeof m.score === "number" ? m.score : undefined }));
      const has = (re: RegExp) => matches.some(m => re.test(m.category));
      const pep = has(/PEP|POLITICALLY/) || pick(r, "pep", "data.pep") === true;
      const sanctioned = has(/SANCTION|WATCH/) || pick(r, "sanctioned", "data.sanctioned") === true;
      const adverse = has(/ADVERSE|MEDIA/);
      return { status: matches.length || pep || sanctioned ? "REVIEW" : "CLEAR", pep, sanctioned, adverseMedia: adverse, matches };
    } catch (e) { return { status: "UNAVAILABLE", pep: false, sanctioned: false, adverseMedia: false, matches: [], reason: e instanceof Error ? e.message : "AML/PEP unavailable" }; }
  }

  async ocr(i: { docType: string; data: Buffer; mime: string }): Promise<OcrResult> {
    try {
      const body = { document_type: i.docType, mime_type: i.mime, image_base64: i.data.toString("base64") };
      const [x, q] = await Promise.all([this.c.post(this.c.paths.ocr, body), this.c.post(this.c.paths.ocrQuality, body).catch(() => null)]);
      const score = Number(pick(q, "qualityScore", "quality_score", "data.qualityScore", "score") ?? pick(x, "qualityScore", "quality_score") ?? 1);
      const issues: string[] = (pick(q, "issues", "data.issues") ?? []).map(String);
      const fields = { name: s(pick(x, "name", "fullName", "data.name", "data.fullName", "fields.name")), dob: s(pick(x, "dob", "dateOfBirth", "data.dob", "fields.dob")), idNumberMasked: (() => { const n = s(pick(x, "idNumber", "id_number", "data.idNumber", "fields.idNumber")); return n ? maskId(n) : undefined; })(), expiry: s(pick(x, "expiry", "expiryDate", "data.expiry")), docKind: s(pick(x, "documentType", "document_type", "data.documentType")) };
      return { status: score < 0.5 || issues.length ? "POOR_QUALITY" : "OK", fields, quality: { score, issues } };
    } catch (e) { return { status: "UNAVAILABLE", fields: {}, quality: { score: 0, issues: [] }, reason: e instanceof Error ? e.message : "OCR unavailable" }; }
  }
}

/** Deterministic stand-in. Control it with text inside the test file, separated by semicolons: NAME:...;DOB:YYYY-MM-DD;ID:...;BLUR:1. Names containing "PEP" return a PEP match. */
export class MockApisetu implements KycServices {
  readonly name = "mock_apisetu";
  async ckycSearch(i: { idNumber: string }): Promise<CkycStart> {
    if (i.idNumber.startsWith("ZZZ")) return { status: "NOT_FOUND", reason: "No CKYC record for this identifier" };
    return { status: "OTP_SENT", referenceId: "mockref-" + createHash("sha1").update(i.idNumber).digest("hex").slice(0, 10), ckycMasked: "*".repeat(8) + "4321" };
  }
  async ckycDownload(i: { referenceId: string; otp: string }): Promise<CkycRecord> {
    if (i.otp !== "123456") return { status: "FAILED", reason: "OTP is invalid", details: {} };
    return { status: "VERIFIED", name: "ASHA RAO", dob: "1980-05-05", ckycMasked: "*".repeat(8) + "4321", details: { source: "CKYC" } };
  }
  async amlPep(i: { name: string }): Promise<PepResult> {
    const pep = /\bPEP\b/i.test(i.name);
    return pep ? { status: "REVIEW", pep: true, sanctioned: false, adverseMedia: false, matches: [{ name: i.name, category: "PEP", list: "MOCK_PEP", score: 0.97 }] } : { status: "CLEAR", pep: false, sanctioned: false, adverseMedia: false, matches: [] };
  }
  async ocr(i: { data: Buffer }): Promise<OcrResult> {
    const t = i.data.toString("latin1");
    const get = (k: string) => new RegExp(`${k}:([^;\\r\\n\\\\)]+)`).exec(t)?.[1]?.trim();
    const blur = get("BLUR") === "1";
    return { status: blur ? "POOR_QUALITY" : "OK", fields: { name: get("NAME"), dob: get("DOB"), idNumberMasked: get("ID") ? maskId(get("ID")!) : undefined }, quality: { score: blur ? 0.2 : 0.95, issues: blur ? ["image is blurry"] : [] } };
  }
}

let cached: KycServices | null | undefined;
/** KYC_SERVICES=apisetu with credentials -> real; mock outside production (or DEMO_MODE); otherwise none (manual review). */
export function getKycServices(): KycServices | null {
  if (cached !== undefined) return cached;
  const want = (process.env.KYC_SERVICES ?? "").toLowerCase();
  const c = apisetuFromEnv();
  if (want === "apisetu" && c) cached = new ApisetuServices(c);
  else if (want === "mock" && (process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true")) cached = new MockApisetu();
  else cached = null;
  return cached;
}
export function resetKycServices() { cached = undefined; }
export function setKycServicesForTests(s: KycServices | null) { cached = s; }
