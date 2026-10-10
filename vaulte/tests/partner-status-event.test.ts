import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; organizationId: string; partner: string; partnerRef: string | null; status: string; note: string | null; actionUrl: string | null };
const rows: Row[] = []; const audit: unknown[] = [];
vi.mock("../lib/db", () => ({
  db: {
    partnerCustomer: {
      findMany: async ({ where }: any) => rows.filter(r => r.partner === where.partner && r.partnerRef?.startsWith(where.partnerRef.startsWith)),
      update: async ({ where: { id }, data }: any) => { const r = rows.find(x => x.id === id)!; Object.assign(r, data); return r; },
    },
    auditLog: { create: async ({ data }: any) => { audit.push(data); } },
  },
}));
vi.mock("../lib/psp/stablecoin/registry", () => ({ getPartner: () => ({}) }));
import { applyCustomerStatusEvent } from "../lib/partners/customers";

beforeEach(() => { rows.length = 0; audit.length = 0; rows.push({ id: "pc1", organizationId: "org1", partner: "nium", partnerRef: "cust1:wal1", status: "SUBMITTED", note: null, actionUrl: null }); });

describe("partner customer status events (partner webhook)", () => {
  it("approves the customer when the partner says so, and records it", async () => {
    expect(await applyCustomerStatusEvent("nium", { customer_ref: "cust1", state: "APPROVED", note: "Nium status: clear" })).toBe(true);
    expect(rows[0]).toMatchObject({ status: "APPROVED", note: "Nium status: clear", actionUrl: null });
    expect(audit).toHaveLength(1);
  });
  it("a request for information keeps the partner's link so the dashboard can open it", async () => {
    await applyCustomerStatusEvent("nium", { customer_ref: "cust1", state: "NEEDS_INFO", action_url: "https://kyc.example/form" });
    expect(rows[0]).toMatchObject({ status: "NEEDS_INFO", actionUrl: "https://kyc.example/form" });
    await applyCustomerStatusEvent("nium", { customer_ref: "cust1", state: "APPROVED" });
    expect(rows[0].actionUrl).toBeNull();
  });
  it("ignores unknown customers and unknown states", async () => {
    expect(await applyCustomerStatusEvent("nium", { customer_ref: "nobody", state: "APPROVED" })).toBe(false);
    expect(await applyCustomerStatusEvent("nium", { customer_ref: "cust1", state: "WHATEVER" })).toBe(false);
    expect(rows[0].status).toBe("SUBMITTED");
  });
});
