import { describe, expect, it } from "vitest";
import { lookupHs, normalizeHs, searchHs, validateHs } from "../lib/trade/hs";
import { tradeFlags } from "../lib/trade/risk";

describe("HS 2022", () => {
  it("normalises and validates at 4/6/8/10 digits", () => {
    expect(normalizeHs("6203.42 00")).toBe("62034200");
    expect(validateHs("620342")).toMatchObject({ ok: true, level: 6, chapter: "62", national_extension: false });
    expect(validateHs("62034200")).toMatchObject({ ok: true, level: 8, national_extension: true });
    expect(validateHs("6203")).toMatchObject({ ok: true, level: 4 });
    expect(validateHs("6203", { minDigits: 6 })).toMatchObject({ ok: false });
    for (const bad of ["99", "123", "999999", "abcdef", ""]) expect(validateHs(bad).ok, bad).toBe(false);
  });
  it("looks up and searches", () => {
    expect(lookupHs("620342")?.description).toMatch(/Trousers/);
    expect(searchHs("cotton trousers").some(e => e.code === "620342")).toBe(true);
    expect(searchHs("6203").every(e => e.code.startsWith("6203"))).toBe(true);
    expect(searchHs("x")).toEqual([]);
  });
  it("trade flags: arms prohibited, gold reviewed, ordinary goods clear", () => {
    expect(tradeFlags(["930190"])[0]).toMatchObject({ code: "ARMS", severity: "PROHIBITED" });
    expect(tradeFlags(["7108.12"])[0]).toMatchObject({ code: "PRECIOUS_METALS_STONES", severity: "REVIEW" });
    expect(tradeFlags(["284410"])[0].severity).toBe("PROHIBITED");
    expect(tradeFlags(["620342", "090111"])).toEqual([]);
  });
});
