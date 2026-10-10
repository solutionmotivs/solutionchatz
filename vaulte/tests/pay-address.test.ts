import { describe, expect, it } from "vitest";
import { formatHandle, normaliseHandle, validateHandle } from "../lib/pay-address";

describe("Pay ID handles", () => {
  it("accepts ordinary business handles", () => { for (const h of ["acme", "acme-exports", "kyc.co", "a1b", "shree_textiles"]) expect(validateHandle(h), h).toBeNull(); });
  it("rejects too short, too long, odd characters and repeated separators", () => {
    for (const h of ["a", "ab", "x".repeat(31), "-acme", "acme-", "ac me", "ac@me", "acme--co", "acme..co"]) expect(validateHandle(h), h).not.toBeNull();
  });
  it("rejects digit-only handles and reserved or look-alike words", () => {
    for (const h of ["123456", "admin", "support", "vaulte", "pay-ment", "r.b.i", "circle", "n-i-u-m"]) expect(validateHandle(h), h).not.toBeNull();
  });
  it("normalises what people type", () => {
    expect(normaliseHandle("  @Acme@vaulte ")).toBe("acme"); expect(normaliseHandle("ACME")).toBe("acme");
    expect(formatHandle("acme")).toBe("acme@vaulte");
  });
});
