import { describe, expect, it } from "vitest";
import { missingForSubmission, requirementsFor } from "../lib/kyc/requirements";
import { isVerifiedSource, nameMode } from "../lib/kyc/names";

describe("names come from documents and IDs", () => {
  const req = requirementsFor("KYB", "IN", ["EXPORT_SERVICES"]);
  const base = { profile: {}, items: [], people: [{ id: "p1", role: "UBO", fullName: "Asha Rao", nameSource: "USER_ENTERED" }], documents: [] } as any;

  it("strict mode asks for a document-sourced legal name and person names", () => {
    const m = missingForSubmission(req, { ...base, nameStrict: true });
    expect(m.some(x => x.key === "legal_name")).toBe(true);
    expect(m.some(x => x.section === "person" && x.key === "name:p1")).toBe(true);
  });
  it("a typed legal name does not satisfy strict mode, a registry/OCR/staff name does", () => {
    const typed = missingForSubmission(req, { ...base, profile: { legal_name: "Typed Ltd", legal_name_source: "USER_ENTERED" }, nameStrict: true });
    expect(typed.some(x => x.key === "legal_name")).toBe(true);
    for (const src of ["REGISTRY", "OCR", "STAFF", "CKYC"]) {
      const ok = missingForSubmission(req, { ...base, profile: { legal_name: "Real Ltd", legal_name_source: src }, people: [{ id: "p1", role: "UBO", fullName: "Asha Rao", nameSource: src }], nameStrict: true });
      expect(ok.some(x => x.key === "legal_name" || x.section === "person" && String(x.key).startsWith("name:"))).toBe(false);
    }
  });
  it("flag mode keeps the old behaviour (typed names allowed, reviewer checks them)", () => {
    const m = missingForSubmission(req, { ...base, profile: { legal_name: "Typed Ltd" }, nameStrict: false });
    expect(m.some(x => x.key === "legal_name")).toBe(false);
  });
  it("source helpers", () => {
    expect(isVerifiedSource("OCR")).toBe(true);
    expect(isVerifiedSource("USER_ENTERED")).toBe(false);
    expect(nameMode({ NAMES_FROM_DOCUMENTS: "flag" } as any)).toBe("flag");
  });
});
