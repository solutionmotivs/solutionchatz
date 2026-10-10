// Document types and what each transfer is expected to have on file.
// eFIRA/FIRC (inward remittance advice), eBRC (export realisation certificate, DGFT) and bank certificates are issued by
// authorised dealer banks / DGFT / licensed partners. Vaulte stores, links and verifies them; it never issues them.

export const DOC_TYPES = {
  EFIRA: { label: "eFIRA (electronic foreign inward remittance advice)", issuer: "Authorised dealer bank / licensed partner" },
  FIRC: { label: "FIRC (foreign inward remittance certificate)", issuer: "Authorised dealer bank" },
  EBRC: { label: "eBRC (electronic bank realisation certificate)", issuer: "Bank, via DGFT portal" },
  BRC: { label: "BRC (bank realisation certificate)", issuer: "Authorised dealer bank" },
  BANK_CERT: { label: "Bank certificate / confirmation", issuer: "Bank" },
  IRM: { label: "IRM (inward remittance message, EDPMS)", issuer: "Authorised dealer bank, via RBI EDPMS" },
  INVOICE_COPY: { label: "Invoice copy", issuer: "Exporter / supplier" },
  SHIPPING_BILL: { label: "Shipping bill (goods exports)", issuer: "Customs" },
  PURPOSE_PROOF: { label: "Supporting document for the purpose code", issuer: "Customer" },
  OTHER: { label: "Other", issuer: "" },
} as const;

export type DocType = keyof typeof DOC_TYPES;
export const isDocType = (t: string): t is DocType => t in DOC_TYPES;

/** Types a customer may upload (certificates the bank/partner issues can also be uploaded when they send them by email). */
export const UPLOADABLE: DocType[] = ["EFIRA", "FIRC", "EBRC", "BRC", "BANK_CERT", "IRM", "INVOICE_COPY", "SHIPPING_BILL", "PURPOSE_PROOF", "OTHER"];

export interface ChecklistItem {
  type: DocType | "PURPOSE_CODE";
  label: string;
  required: boolean;
  status: "PRESENT" | "PENDING" | "NOT_APPLICABLE";
  /** Who produces it. */
  from: string;
  detail?: string;
}

interface TransferLike { destCountry: string; originCountry: string; kind: string; status: string; purposeCode: string | null; invoiceId: string | null; efiraRef: string | null }
interface DocLike { type: string; status: string }

/** P01xx purpose codes are goods exports; those need a realisation certificate (eBRC) as well. */
export const isGoodsPurpose = (code?: string | null) => !!code && /^P01\d\d$/.test(code);

export function checklistFor(t: TransferLike, docs: DocLike[]): ChecklistItem[] {
  const has = (type: DocType) => docs.some(d => d.type === type && d.status !== "REJECTED");
  const done = t.status === "COMPLETED";
  const out: ChecklistItem[] = [];
  const indiaInbound = t.destCountry === "IN" && t.kind === "BUSINESS";
  if (indiaInbound) {
    out.push({ type: "PURPOSE_CODE", label: "RBI purpose code", required: true, status: t.purposeCode ? "PRESENT" : "PENDING", from: "Customer (at transfer creation)", detail: t.purposeCode ?? undefined });
    out.push({ type: "INVOICE_COPY", label: DOC_TYPES.INVOICE_COPY.label, required: true, status: t.invoiceId || has("INVOICE_COPY") ? "PRESENT" : "PENDING", from: "Customer" });
    out.push({ type: "EFIRA", label: DOC_TYPES.EFIRA.label, required: true, status: has("EFIRA") || has("FIRC") || !!t.efiraRef ? "PRESENT" : done ? "PENDING" : "NOT_APPLICABLE", from: DOC_TYPES.EFIRA.issuer, detail: done ? "Issued by the bank/partner after the payout; ask them if it has not arrived within a few working days" : "Available after the payout completes" });
    if (isGoodsPurpose(t.purposeCode)) {
      out.push({ type: "SHIPPING_BILL", label: DOC_TYPES.SHIPPING_BILL.label, required: true, status: has("SHIPPING_BILL") ? "PRESENT" : "PENDING", from: "Customer / customs" });
      out.push({ type: "EBRC", label: DOC_TYPES.EBRC.label, required: true, status: has("EBRC") || has("BRC") ? "PRESENT" : done ? "PENDING" : "NOT_APPLICABLE", from: DOC_TYPES.EBRC.issuer, detail: "Needed to close the export (EDPMS). Your bank generates it on the DGFT portal after realisation." });
    }
  } else if (t.originCountry === "IN") {
    out.push({ type: "PURPOSE_CODE", label: "RBI purpose code", required: true, status: t.purposeCode ? "PRESENT" : "PENDING", from: "Customer (at transfer creation)", detail: t.purposeCode ?? undefined });
    out.push({ type: "PURPOSE_PROOF", label: DOC_TYPES.PURPOSE_PROOF.label, required: false, status: has("PURPOSE_PROOF") ? "PRESENT" : "PENDING", from: "Customer", detail: "e.g. admission letter for education remittances" });
  }
  return out;
}
