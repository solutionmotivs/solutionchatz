import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { candidateRefs, detectType, extractNumber, senderAllowed, verifySignature } from "../lib/documents/inbound-email";
import { missingCertificates } from "../lib/documents/poll";

describe("inbound email rules", () => {
  it("signature: HMAC of the raw body, constant-time, secret required", () => {
    const raw = '{"a":1}'; const sig = createHmac("sha256", "s3cret").update(raw).digest("hex");
    expect(verifySignature(raw, `sha256=${sig}`, "s3cret")).toBe(true); expect(verifySignature(raw, sig, "s3cret")).toBe(true);
    expect(verifySignature(raw, "sha256=00", "s3cret")).toBe(false); expect(verifySignature(raw, null, "s3cret")).toBe(false); expect(verifySignature(raw, sig, "")).toBe(false);
  });
  it("sender allow-list fails closed: exact address or @domain", () => {
    expect(senderAllowed("Bank <alerts@bank.example>", "alerts@bank.example,@dgft.gov.in")).toBe(true);
    expect(senderAllowed("x@dgft.gov.in", "alerts@bank.example,@dgft.gov.in")).toBe(true);
    expect(senderAllowed("x@evil-dgft.gov.in.attacker.com", "@dgft.gov.in")).toBe(false);
    expect(senderAllowed("alerts@bank.example", "")).toBe(false);
  });
  it("detects the certificate type and number from the text", () => {
    expect(detectType("eBRC for shipment", "x.pdf")).toBe("EBRC"); expect(detectType("Your FIRC")).toBe("FIRC"); expect(detectType("e-FIRA advice")).toBe("EFIRA");
    expect(detectType("Bank realisation certificate")).toBe("BRC"); expect(detectType("IRM EDPMS")).toBe("IRM"); expect(detectType("random")).toBe("OTHER");
    expect(extractNumber("eBRC No. 2026ABC/998877 issued")).toBe("2026ABC/998877"); expect(extractNumber("nothing here")).toBeNull();
  });
  it("reference candidates need a digit and some length (no plain words)", () => {
    const c = candidateRefs("Re: payment cmv1abc2d3e4f5g6h7i8j9k0l dated 2026-10-06 thanks");
    expect(c).toContain("cmv1abc2d3e4f5g6h7i8j9k0l"); expect(c).not.toContain("payment");
  });
  it("what an India business transfer still lacks", () => {
    const t = { destCountry: "IN", kind: "BUSINESS", purposeCode: "P0103" };
    expect(missingCertificates(t, [])).toEqual(["EFIRA", "EBRC"]);
    expect(missingCertificates(t, [{ type: "FIRC", status: "VERIFIED" }, { type: "EBRC", status: "RECEIVED" }])).toEqual([]);
    expect(missingCertificates(t, [{ type: "EFIRA", status: "REJECTED" }])).toEqual(["EFIRA", "EBRC"]);
    expect(missingCertificates({ ...t, purposeCode: "P0802" }, [{ type: "EFIRA", status: "VERIFIED" }])).toEqual([]);
    expect(missingCertificates({ ...t, destCountry: "AE" }, [])).toEqual([]);
  });
});
