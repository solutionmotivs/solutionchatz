import { describe, expect, it } from "vitest";
import { evaluateTransfer, type GuardContext } from "@/lib/guardrails";

const verified = (country: string, type: "BUSINESS" | "INDIVIDUAL" = "BUSINESS") => ({
  verified: true, entityType: type, country, panVerified: true,
});

const base = (over: Partial<GuardContext> = {}): GuardContext => ({
  kind: "BUSINESS",
  originCountry: "US",
  destCountry: "IN",
  amountUsd: 5_000,
  amountInr: 5_000 * 83.42,
  fundingMethod: "STABLECOIN",
  usesStablecoin: true,
  token: "USDC",
  payoutAssetIsFiat: true,
  purposeCode: "P0802",
  invoiceId: "inv_1",
  sender: verified("US"),
  recipient: verified("IN"),
  indiaAuths: ["PA_CB_E"],
  history: { recipientTransfersThisCalendarYear: 0, senderUsdThisFinancialYear: 0 },
  ...over,
});

const codes = (c: GuardContext) => evaluateTransfer(c).violations.map(v => v.code);

describe("guardrails: business foreign -> India (stablecoin funded)", () => {
  it("allows a compliant invoice payment", () => {
    expect(evaluateTransfer(base()).allowed).toBe(true);
  });
  it("requires an invoice and an RBI purpose code", () => {
    expect(codes(base({ invoiceId: null }))).toContain("INVOICE_REQUIRED");
    expect(codes(base({ purposeCode: null }))).toContain("PURPOSE_CODE_REQUIRED");
    expect(codes(base({ purposeCode: "BAD" }))).toContain("PURPOSE_CODE_REQUIRED");
  });
  it("blocks above the Rs 25 lakh PA-CB cap", () => {
    expect(codes(base({ amountInr: 2_500_001 }))).toContain("ABOVE_PA_CB_CAP");
    expect(codes(base({ amountInr: 2_500_000 }))).not.toContain("ABOVE_PA_CB_CAP");
  });
  it("requires a PA-CB export authorised partner", () => {
    expect(codes(base({ indiaAuths: [] }))).toContain("PARTNER_AUTH_MISSING");
  });
  it("never pays crypto to India", () => {
    expect(codes(base({ payoutAssetIsFiat: false }))).toContain("INDIA_DEST_FIAT_ONLY");
  });
  it("requires verified parties", () => {
    expect(codes(base({ sender: { ...verified("US"), verified: false } }))).toContain("SENDER_NOT_VERIFIED");
    expect(codes(base({ recipient: { ...verified("IN"), verified: false } }))).toContain("RECIPIENT_NOT_VERIFIED");
  });
});

describe("guardrails: India origin is fiat only", () => {
  it("blocks stablecoin funding from India", () => {
    const c = base({ originCountry: "IN", destCountry: "US", indiaAuths: ["PA_CB_I"], sender: verified("IN"), recipient: verified("US") });
    expect(codes(c)).toContain("INDIA_ORIGIN_NO_CRYPTO");
  });
  it("allows fiat-only business import payment from India", () => {
    const c = base({
      originCountry: "IN", destCountry: "US", fundingMethod: "FIAT_LOCAL", usesStablecoin: false, token: null,
      indiaAuths: ["PA_CB_I"], sender: verified("IN"), recipient: verified("US"),
    });
    expect(evaluateTransfer(c).allowed).toBe(true);
  });
});

describe("guardrails: personal transfers", () => {
  const personalIn = (over: Partial<GuardContext> = {}) =>
    base({
      kind: "PERSONAL", amountUsd: 1_000, amountInr: 83_420, invoiceId: null, purposeCode: null,
      indiaAuths: ["MTSS"], sender: verified("US", "INDIVIDUAL"), recipient: verified("IN", "INDIVIDUAL"), ...over,
    });
  it("allows USD 2,500 inbound (MTSS)", () => {
    expect(evaluateTransfer(personalIn({ amountUsd: 2_500 })).allowed).toBe(true);
  });
  it("blocks above USD 2,500 and after 30 transfers in the calendar year", () => {
    expect(codes(personalIn({ amountUsd: 2_501 }))).toContain("ABOVE_MTSS_CAP");
    expect(codes(personalIn({ history: { recipientTransfersThisCalendarYear: 30, senderUsdThisFinancialYear: 0 } }))).toContain("MTSS_COUNT_EXCEEDED");
    expect(codes(personalIn({ history: { recipientTransfersThisCalendarYear: 29, senderUsdThisFinancialYear: 0 } }))).not.toContain("MTSS_COUNT_EXCEEDED");
  });
  it("applies LRS rules to India -> abroad personal transfers", () => {
    const out = (over: Partial<GuardContext> = {}) =>
      base({
        kind: "PERSONAL", originCountry: "IN", destCountry: "GB", amountUsd: 1_000, fundingMethod: "FIAT_LOCAL",
        usesStablecoin: false, token: null, invoiceId: null, purposeCode: "S0305", indiaAuths: ["LRS_AD"],
        sender: verified("IN", "INDIVIDUAL"), recipient: verified("GB", "INDIVIDUAL"), ...over,
      });
    expect(evaluateTransfer(out()).allowed).toBe(true);
    expect(codes(out({ history: { recipientTransfersThisCalendarYear: 0, senderUsdThisFinancialYear: 249_500 } }))).toContain("LRS_LIMIT_EXCEEDED");
    expect(codes(out({ purposeCode: null }))).toContain("PURPOSE_CODE_REQUIRED");
    expect(codes(out({ sender: { ...verified("IN", "INDIVIDUAL"), panVerified: false } }))).toContain("PAN_REQUIRED");
  });
  it("caps personal transfers outside India at USD 10,000", () => {
    const c = base({
      kind: "PERSONAL", originCountry: "GB", destCountry: "AE", amountUsd: 10_001, invoiceId: null, indiaAuths: [],
      sender: verified("GB", "INDIVIDUAL"), recipient: verified("AE", "INDIVIDUAL"),
    });
    expect(codes(c)).toContain("ABOVE_PERSONAL_CAP");
  });
});

describe("guardrails: sanctions", () => {
  it("blocks sanctioned countries", () => {
    expect(codes(base({ originCountry: "IR" }))).toContain("SANCTIONED_COUNTRY");
  });
  it("flags high-risk countries for review", () => {
    expect(evaluateTransfer(base({ originCountry: "RU" })).reviewFlags).toContain("HIGH_RISK_COUNTRY");
  });
});
