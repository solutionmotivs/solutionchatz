import { describe, expect, it } from "vitest";
import { fetchFrankfurter } from "../lib/fx";

const resp = (body: unknown, ok = true) => (async (url: string) => { (resp as any).last = url; return { ok, json: async () => body } as Response; }) as unknown as typeof fetch;

describe("free ECB source", () => {
  it("prices pegged currencies without a call and the rest from Frankfurter", async () => {
    const f = resp({ rates: { INR: 96.78, EUR: 0.894 } });
    expect(await fetchFrankfurter("USD", ["AED", "SAR", "INR", "EUR", "CNH"], f)).toEqual({ AED: 3.6725, SAR: 3.75, INR: 96.78, EUR: 0.894 });
    expect((resp as any).last).toMatch(/symbols=INR,EUR,CNH$/);
  });
  it("makes no call when only pegs are needed, ignores junk, and survives failures", async () => {
    let called = false;
    const f = (async () => { called = true; return { ok: true, json: async () => ({}) } as Response; }) as unknown as typeof fetch;
    expect(await fetchFrankfurter("USD", ["AED"], f)).toEqual({ AED: 3.6725 }); expect(called).toBe(false);
    expect(await fetchFrankfurter("USD", ["INR"], resp({ rates: { INR: "x", EUR: -1 } }))).toEqual({});
    expect(await fetchFrankfurter("USD", ["INR"], (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toEqual({});
    expect(await fetchFrankfurter("EUR", ["INR"], f)).toEqual({});
  });
});
