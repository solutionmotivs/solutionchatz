// "Licensed principal of record" rules. Vaulte onboards and instructs, but the money is held, converted and paid out only by a licensed partner.
// This is enforced when the live catalogue loads (a leg without a declared structure never routes) and, per country, by a counsel flag.
//
// AGENT_REGISTRATION_<CC>=confirmed        counsel confirmed that Vaulte's agent/distributor registration or notification (where the country
//                                          requires one) is in place with the partner for customers in <CC>
// AGENT_REGISTRATION_<CC>=not_required     counsel confirmed in writing that none is required there
// anything else / unset                    routes where Vaulte acts as AGENT stay closed for customers in <CC>
import { z } from "zod";
import type { Leg, PartnerStructure, Route } from "@/lib/stablecoin/types";

export const StructureSchema = z.object({
  principal: z.string().min(2).refine(p => !p.startsWith("mock_"), "mock partners cannot be a principal"),
  fundsHeldBy: z.literal("PARTNER", { errorMap: () => ({ message: "funds must be held by the licensed partner, never by Vaulte" }) }),
  accountHolder: z.enum(["CUSTOMER_SUBACCOUNT", "PARTNER_SAFEGUARDED"], { errorMap: () => ({ message: "accounts must be in the customer's name or the partner's safeguarded account; Vaulte-owned or pooled accounts are not allowed" }) }),
  vaulteRole: z.enum(["AGENT", "TECH_PROVIDER"]),
  agreementRef: z.string().min(3, "reference the signed partner agreement"),
});

export function assertPrincipalStructure(legs: Leg[]): void {
  for (const l of legs) {
    const r = StructureSchema.safeParse(l.structure);
    if (!r.success) throw new Error(`leg ${l.id}: ${r.error.errors[0].path.join(".") || "structure"}: ${r.error.errors[0].message}`);
    if (r.data.principal !== l.partner) throw new Error(`leg ${l.id}: principal must be the partner that executes the leg (${l.partner})`);
  }
}

export type AgentRegistration = "confirmed" | "not_required" | "missing";
export function agentRegistration(country: string, env: NodeJS.ProcessEnv = process.env): AgentRegistration {
  const v = (env[`AGENT_REGISTRATION_${country.toUpperCase()}`] ?? "").trim().toLowerCase();
  return v === "confirmed" ? "confirmed" : v === "not_required" ? "not_required" : "missing";
}

export const routeUsesVaulteAsAgent = (r: Route) => r.legs.some(l => l.structure?.vaulteRole === "AGENT");

/**
 * Live routes only. Splits routes into those that may carry a customer from `senderCountry` and, if some are held back, why.
 * Routes where Vaulte is only a technology provider are always allowed here; counsel decides everything else through LIVE_COUNTRIES.
 */
export function applyAgentGate(routes: Route[], senderCountry: string, env: NodeJS.ProcessEnv = process.env): { allowed: Route[]; held: number } {
  const ok = agentRegistration(senderCountry, env) !== "missing";
  const allowed = routes.filter(r => ok || !routeUsesVaulteAsAgent(r));
  return { allowed, held: routes.length - allowed.length };
}

export type { PartnerStructure };

/**
 * Live FX-provider legs (Airwallex, Currencycloud, Wise, ...) are created at quote time, so their structure comes from configuration:
 * PARTNER_STRUCTURE_JSON={"airwallex":{"principal":"airwallex","fundsHeldBy":"PARTNER","accountHolder":"CUSTOMER_SUBACCOUNT","vaulteRole":"AGENT","agreementRef":"AWX-2026-001"}}
 * A provider without an entry cannot carry live money.
 */
export function providerStructure(provider: string, env: NodeJS.ProcessEnv = process.env): PartnerStructure | null {
  try {
    const all = JSON.parse(env.PARTNER_STRUCTURE_JSON || "{}") as Record<string, unknown>;
    const r = StructureSchema.safeParse(all[provider]);
    return r.success && r.data.principal === provider ? (r.data as PartnerStructure) : null;
  } catch { return null; }
}
