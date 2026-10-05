import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { checklistFor, isGoodsPurpose } from "../lib/documents/types";
import { fingerprint, paymentAdvicePdf, realisationPackPdf, NOTICE, type PackData } from "../lib/documents/pdf";

const base = { destCountry: "IN", originCountry: "US", kind: "BUSINESS", status: "COMPLETED", purposeCode: "P0802", invoiceId: "inv", efiraRef: null as string | null };
const byType = (items: ReturnType<typeof checklistFor>, t: string) => items.find(i => i.type === t);

describe("document checklist", () => {
  it("an Indian services export needs purpose code, invoice and an eFIRA after payout", () => {
    const c = checklistFor(base, []);
    expect(byType(c, "PURPOSE_CODE")?.status).toBe("PRESENT");
    expect(byType(c, "INVOICE_COPY")?.status).toBe("PRESENT");
    expect(byType(c, "EFIRA")?.status).toBe("PENDING");
    expect(byType(c, "EBRC")).toBeUndefined();
  });
  it("the eFIRA is not due before the payout completes, and a partner reference satisfies it", () => {
    expect(byType(checklistFor({ ...base, status: "PAYING_OUT" }, []), "EFIRA")?.status).toBe("NOT_APPLICABLE");
    expect(byType(checklistFor({ ...base, efiraRef: "EFIRA-1" }, []), "EFIRA")?.status).toBe("PRESENT");
    expect(byType(checklistFor(base, [{ type: "FIRC", status: "VERIFIED" }]), "EFIRA")?.status).toBe("PRESENT");
  });
  it("a rejected document does not count", () => {
    expect(byType(checklistFor(base, [{ type: "EFIRA", status: "REJECTED" }]), "EFIRA")?.status).toBe("PENDING");
  });
  it("goods exports (P01xx) also need a shipping bill and an eBRC", () => {
    expect(isGoodsPurpose("P0101")).toBe(true); expect(isGoodsPurpose("P0802")).toBe(false); expect(isGoodsPurpose(null)).toBe(false);
    const c = checklistFor({ ...base, purposeCode: "P0101" }, []);
    expect(byType(c, "SHIPPING_BILL")?.status).toBe("PENDING");
    expect(byType(c, "EBRC")?.status).toBe("PENDING");
    const done = checklistFor({ ...base, purposeCode: "P0101" }, [{ type: "SHIPPING_BILL", status: "VERIFIED" }, { type: "EBRC", status: "RECEIVED" }]);
    expect(byType(done, "SHIPPING_BILL")?.status).toBe("PRESENT"); expect(byType(done, "EBRC")?.status).toBe("PRESENT");
  });
  it("outward Indian personal transfers need a purpose code; other corridors need nothing special", () => {
    expect(checklistFor({ ...base, originCountry: "IN", destCountry: "US", kind: "PERSONAL" }, []).map(i => i.type)).toEqual(["PURPOSE_CODE", "PURPOSE_PROOF"]);
    expect(checklistFor({ ...base, originCountry: "US", destCountry: "DE" }, [])).toEqual([]);
  });
});

const data = (over: Partial<PackData> = {}): PackData => ({
  generatedAt: "2026-10-05T10:00:00.000Z",
  transfer: { id: "cmtest12345678", status: "COMPLETED", kind: "BUSINESS", createdAt: "2026-10-05T09:00:00.000Z", completedAt: "2026-10-05T09:30:00.000Z", originCountry: "US", destCountry: "IN", sourceCurrency: "USD", destCurrency: "INR", sourceAmount: "500000", destAmount: "41000000", sourceUsd: "500000", markupBps: 30, markupUsd: "1500", partnerCostUsd: "1800", purposeCode: "P0802", externalRef: "PARTNER-1", efiraRef: "EFIRA-77", route: { partners: ["mock_us", "mock_in_pacb"], legs: [{ partner: "mock_us", kind: "ACCEPT_TOKEN", rails: ["ONCHAIN"] }, { partner: "mock_in_pacb", kind: "INDIA_PAYOUT", rails: ["IMPS"] }], token: "USDC" }, fx: null },
  sender: { name: "Acme Inc", country: "US" }, recipient: { name: "Alpha Exports Pvt Ltd", country: "IN" }, invoice: { number: "INV-1", currency: "USD", total: "500000" }, organization: "Alpha Co",
  timeline: [{ at: "2026-10-05T09:00:00.000Z", event: "Transfer created from a firm quote" }, { at: "2026-10-05T09:30:00.000Z", event: "Transfer completed" }],
  ledger: Array.from({ length: 60 }, (_, i) => ({ seq: i + 1, at: "2026-10-05T09:10:00.000Z", kind: "MEMO_PAYOUT", account: "9200 MEMO Customer transfer obligations", currency: "USD", amountMinor: "100", usd: "100" })),
  documents: [{ id: "d1", type: "EFIRA", number: "EFIRA-77", issuer: "Partner", issuedOn: null, status: "VERIFIED", sha256: null, filename: null, source: "PARTNER" }],
  checklist: checklistFor({ ...base, efiraRef: "EFIRA-77" }, [{ type: "EFIRA", status: "VERIFIED" }]),
  ...over,
});

describe("PDF generation", () => {
  it("payment advice is a valid single-purpose PDF", async () => {
    const bytes = await paymentAdvicePdf(data());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBe("Payment advice");
  });
  it("the realisation pack paginates long ledgers and never contains non-latin text that would crash the font", async () => {
    const d = data({ recipient: { name: "अल्फा Exports ₹ Pvt Ltd", country: "IN" } });
    const bytes = await realisationPackPdf(d);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(doc.getTitle()).toBe("Realisation pack");
  });
  it("the fingerprint ignores generation time but changes with the facts", () => {
    const a = data(), b = data({ generatedAt: "2027-01-01T00:00:00.000Z" }), c = data({ sender: { name: "Someone Else", country: "US" } });
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a)).not.toBe(fingerprint(c));
  });
  it("the notice says plainly that this is not a bank certificate", () => {
    expect(NOTICE).toMatch(/NOT an eFIRA, FIRC, eBRC/);
    expect(NOTICE).toMatch(/does not hold customer funds/);
  });
});
