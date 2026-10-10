import { describe, expect, it } from "vitest";
import { parseCatalog } from "../lib/routing/partners-config";
import { agentRegistration, applyAgentGate, assertPrincipalStructure, providerStructure } from "../lib/routing/structure";
import { buildLiveLegs } from "../lib/fx/aggregator";
import { MockFxDesk } from "../lib/fx/providers/mock";
import type { Leg, Route } from "../lib/stablecoin/types";

const structure = { principal: "airwallex", fundsHeldBy: "PARTNER", accountHolder: "CUSTOMER_SUBACCOUNT", vaulteRole: "AGENT", agreementRef: "AWX-1" };
const leg = (o: Record<string, unknown> = {}) => ({ id: "awx.direct.usdeur", partner: "airwallex", kind: "DIRECT", country: "AU", jurisdiction: "AU", srcCurrency: "USD", destCurrency: "EUR", rails: ["SWIFT"], tokens: [], chains: [], spreadBps: 20, feeBps: 0, fixedFeeUsd: 5, etaSec: 3600, minUsd: 10, maxUsd: 100000, kinds: ["BUSINESS"], structure, ...o });
const route = (role: "AGENT" | "TECH_PROVIDER"): Route => ({ legs: [{ partner: "airwallex", structure: { ...structure, vaulteRole: role } } as unknown as Leg] } as unknown as Route);

describe("principal-of-record structure", () => {
  it("a live leg must declare the licensed partner as principal and holder of funds", () => {
    expect(parseCatalog(JSON.stringify([leg()]))).toHaveLength(1);
    expect(() => parseCatalog(JSON.stringify([leg({ structure: undefined })]))).toThrow();
    expect(() => parseCatalog(JSON.stringify([leg({ structure: { ...structure, fundsHeldBy: "VAULTE" } })]))).toThrow(/held by the licensed partner/);
    expect(() => parseCatalog(JSON.stringify([leg({ structure: { ...structure, accountHolder: "VAULTE_POOLED" } })]))).toThrow(/pooled/);
    expect(() => parseCatalog(JSON.stringify([leg({ structure: { ...structure, agreementRef: "" } })]))).toThrow(/agreement/);
  });
  it("the principal must be the partner that executes the leg", () => {
    expect(() => assertPrincipalStructure([leg({ structure: { ...structure, principal: "wise" } }) as unknown as Leg])).toThrow(/principal must be the partner/);
  });
  it("agent routes stay closed for a country until counsel confirms the registration", () => {
    const env = {} as unknown as NodeJS.ProcessEnv;
    expect(agentRegistration("US", env)).toBe("missing");
    expect(agentRegistration("us", { AGENT_REGISTRATION_US: "Confirmed" } as unknown as NodeJS.ProcessEnv)).toBe("confirmed");
    expect(agentRegistration("DE", { AGENT_REGISTRATION_DE: "not_required" } as unknown as NodeJS.ProcessEnv)).toBe("not_required");
    expect(agentRegistration("FR", { AGENT_REGISTRATION_FR: "yes" } as unknown as NodeJS.ProcessEnv)).toBe("missing");
    const routes = [route("AGENT"), route("TECH_PROVIDER")];
    expect(applyAgentGate(routes, "US", env)).toMatchObject({ held: 1 });
    expect(applyAgentGate(routes, "US", env).allowed).toEqual([routes[1]]);
    expect(applyAgentGate(routes, "US", { AGENT_REGISTRATION_US: "confirmed" } as unknown as NodeJS.ProcessEnv).allowed).toHaveLength(2);
  });
  it("live FX providers need a declared structure; test mode does not", async () => {
    const desk = new MockFxDesk("mock_fx_a", 28, 0);
    const args = { kind: "BUSINESS" as const, originCountry: "US", destCountry: "DE", sourceCurrency: "USD", destCurrency: "EUR", sourceAmountMinor: 100000, sourceAmountUsd: 1000, midDestPerSource: 0.9, fundingMethod: "FIAT_LOCAL", providers: [desk] };
    const test = await buildLiveLegs({ ...args, sandbox: true });
    expect(test.legs.length).toBe(1);
    const live = await buildLiveLegs({ ...args, sandbox: false });
    expect(live.legs).toHaveLength(0);
    expect(live.errors[0].error).toMatch(/structure/);
    expect(providerStructure("mock_fx_a", { PARTNER_STRUCTURE_JSON: JSON.stringify({ mock_fx_a: { ...structure, principal: "mock_fx_a" } }) } as unknown as NodeJS.ProcessEnv)).toBeNull(); // mock partners can never be a principal
    expect(providerStructure("airwallex", { PARTNER_STRUCTURE_JSON: JSON.stringify({ airwallex: structure }) } as unknown as NodeJS.ProcessEnv)?.principal).toBe("airwallex");
    expect(providerStructure("airwallex", { PARTNER_STRUCTURE_JSON: "not json" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});
