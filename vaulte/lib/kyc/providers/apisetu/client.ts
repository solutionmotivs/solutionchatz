// API Setu (India's government API marketplace, apisetu.gov.in) client for KYC-related services offered by registered
// organisations: CKYC search/download (CERSAI via an authorised intermediary), AML/PEP screening and KYC OCR (BureauID).
// UNVERIFIED LIVE: the public directory is client-rendered and per-API specs sit behind registration, so request/response
// field names below follow the services' described purpose and are normalised defensively; every path is overridable by env.
// Run scripts/apisetu-smoke.mjs with your own registered credentials and adjust APISETU_PATH_* if a path differs.
import { http, PartnerError } from "@/lib/psp/http";

export interface ApisetuConfig {
  baseUrl: string; clientId: string; apiKey: string;
  paths: { ckycSearch: string; ckycDownload: string; amlPep: string; ocr: string; ocrQuality: string };
  timeoutMs?: number;
}

export const DEFAULT_PATHS = {
  ckycSearch: "/ckyc/v1/search", ckycDownload: "/ckyc/v1/download", amlPep: "/amlpep/v1/verify", ocr: "/kycocr/v1/extract", ocrQuality: "/kycocr/v1/quality",
};

export class ApisetuClient {
  constructor(private cfg: ApisetuConfig) {}

  async post<T = any>(path: string, body: unknown): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await http(`${this.cfg.baseUrl}${path}`, {
        method: "POST", json: body, timeoutMs: this.cfg.timeoutMs ?? 25_000,
        headers: { "X-APISETU-CLIENTID": this.cfg.clientId, "X-APISETU-APIKEY": this.cfg.apiKey },
      });
      if (r.status >= 200 && r.status < 300) return r.json as T;
      if ((r.status >= 500 || r.status === 429) && attempt < 2) { await new Promise(res => setTimeout(res, 500 * (attempt + 1))); continue; }
      const msg = r.json?.message ?? r.json?.error_description ?? r.json?.error ?? r.status;
      throw new PartnerError(r.status, String(r.json?.errorCode ?? r.json?.code ?? `HTTP_${r.status}`), `API Setu ${path} failed: ${msg}`);
    }
    throw new PartnerError(0, "UNREACHABLE", "API Setu request failed after retries");
  }

  get paths() { return this.cfg.paths; }
}

export function apisetuFromEnv(env = process.env): ApisetuClient | null {
  if (!env.APISETU_CLIENT_ID || !env.APISETU_API_KEY) return null;
  return new ApisetuClient({
    baseUrl: (env.APISETU_BASE_URL ?? "https://apisetu.gov.in").replace(/\/$/, ""), clientId: env.APISETU_CLIENT_ID, apiKey: env.APISETU_API_KEY,
    paths: {
      ckycSearch: env.APISETU_PATH_CKYC_SEARCH ?? DEFAULT_PATHS.ckycSearch, ckycDownload: env.APISETU_PATH_CKYC_DOWNLOAD ?? DEFAULT_PATHS.ckycDownload,
      amlPep: env.APISETU_PATH_AMLPEP ?? DEFAULT_PATHS.amlPep, ocr: env.APISETU_PATH_OCR ?? DEFAULT_PATHS.ocr, ocrQuality: env.APISETU_PATH_OCR_QUALITY ?? DEFAULT_PATHS.ocrQuality,
    },
  });
}
