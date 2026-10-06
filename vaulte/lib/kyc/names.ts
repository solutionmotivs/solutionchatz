// "Names only from documents and IDs": a legal or personal name used in KYC/KYB must come from an official source
// (registry record, OCR of the uploaded document, CKYC, or a named staff member), never from what someone typed.
// Strict mode is on whenever a document-reading provider is configured. Without one, typed names are accepted but flagged
// USER_ENTERED so a reviewer must check them against the uploaded documents.
import { getKycServices } from "./providers/apisetu/services";
import { nameMatchScore } from "./registries";

export const VERIFIED_NAME_SOURCES = new Set(["OCR", "CKYC", "REGISTRY", "DIGILOCKER", "STAFF"]);
export type NameMode = "strict" | "flag";

export function nameMode(env: NodeJS.ProcessEnv = process.env): NameMode {
  if (env.NAMES_FROM_DOCUMENTS === "flag") return "flag";
  return getKycServices() ? "strict" : "flag";
}
export const isVerifiedSource = (s?: string | null) => !!s && VERIFIED_NAME_SOURCES.has(s);

/** Document business types whose OCR name is the entity's legal name. */
export const BUSINESS_NAME_DOCS = new Set(["CERT_OF_INCORPORATION", "REGISTRY_EXTRACT", "TRADE_LICENCE_COPY", "GST_CERTIFICATE"]);
export const PERSON_NAME_DOCS = new Set(["ID_PROOF"]);

/** How far the typed name differs from the document's name (0 = unrelated, 1 = same). */
export const typedVsDocument = (typed: string, doc: string) => nameMatchScore(typed, doc);
