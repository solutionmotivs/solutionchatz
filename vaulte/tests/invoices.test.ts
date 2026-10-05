import { describe, expect, it } from "vitest";
import { computeLines, formatNumber, safeReturnUrl } from "../lib/invoices/calc";

describe("invoice arithmetic", () => {
  it("rounds tax per line and totals agree with the lines", () => {
    const c = computeLines([
      { description: "A", quantity: 3, unit_price: 3333, tax_rate: 18 },
      { description: "B", quantity: 1.5, unit_price: 1001, tax_rate: 5 },
      { description: "C", quantity: 1, unit_price: 500, tax_rate: 0 },
    ]);
    expect(c.lines.map(l => l.net)).toEqual([9999, 1502, 500]);
    expect(c.lines.map(l => l.tax)).toEqual([1800, 75, 0]);
    expect(c.subtotal).toBe(12001); expect(c.tax).toBe(1875); expect(c.total).toBe(13876);
    expect(c.lines.reduce((s, l) => s + l.total, 0)).toBe(c.total);
    expect(c.taxByRate).toEqual([{ rate: 0, net: 500, tax: 0 }, { rate: 5, net: 1502, tax: 75 }, { rate: 18, net: 9999, tax: 1800 }]);
  });
  it("formats sequential numbers", () => {
    expect(formatNumber("INV", 2026, 1)).toBe("INV-2026-0001");
    expect(formatNumber("PF", 2026, 12345)).toBe("PF-2026-12345");
  });
  it("return URLs must be https, without credentials", () => {
    expect(safeReturnUrl("https://shop.example.com/thanks?o=1")).toBe("https://shop.example.com/thanks?o=1");
    expect(safeReturnUrl("http://shop.example.com/x")).toBeNull();
    expect(safeReturnUrl("javascript:alert(1)")).toBeNull();
    expect(safeReturnUrl("https://user:pw@shop.example.com/")).toBeNull();
    expect(safeReturnUrl("http://localhost:3000/ok")).not.toBeNull();
    expect(safeReturnUrl(undefined)).toBeNull();
    expect(safeReturnUrl("not a url")).toBeNull();
  });
});

import { toXml } from "../lib/reports/xml";
describe("XML serializer", () => {
  it("escapes text and attributes, repeats arrays, and sanitises element names", () => {
    const x = toXml("Root", { "@id": 'a"b<c', Name: "Tom & <Jerry> 'x'", Item: [{ V: 1 }, { V: 2 }], "bad name!": "ok", Ctl: "a\u0001b" });
    expect(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(x).toContain('id="a&quot;b&lt;c"');
    expect(x).toContain("<Name>Tom &amp; &lt;Jerry&gt; &apos;x&apos;</Name>");
    expect(x.match(/<Item>/g)).toHaveLength(2);
    expect(x).toContain("<bad_name_>ok</bad_name_>");
    expect(x).toContain("<Ctl>ab</Ctl>");
  });
});
