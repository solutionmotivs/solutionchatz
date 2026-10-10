// Licensed escrow agent adapter. The agent (not Vaulte) receives, holds and releases the money. Vaulte orchestrates the
// deal and instructs the agent. No live agent adapter ships with this repo: a live PARTNER_ESCROW deal needs a contract with
// a licensed escrow provider and an adapter registered in getEscrowAgent(). Until then live organisations can only use PAY_ON_APPROVAL.
import { createHmac, timingSafeEqual } from "crypto";
import { mockWebhookSecret } from "@/lib/psp/stablecoin/mock";

export interface EscrowDealInfo { id: string; currency: string; title: string; buyerName: string; buyerEmail: string; buyerCountry: string; sellerName: string; sellerCountry: string }
export interface EscrowMilestoneInfo { id: string; seq: number; title: string; amountMinor: bigint }

export interface EscrowAgent {
  readonly id: string;
  /** Opens the escrow arrangement for the deal at the agent. */
  createEscrow(deal: EscrowDealInfo, milestones: EscrowMilestoneInfo[]): Promise<{ agentRef: string }>;
  /** Where and how the buyer funds one milestone (bank details and a reference the agent will match). */
  fundingInstructions(deal: EscrowDealInfo, m: EscrowMilestoneInfo, agentRef: string): Promise<{ reference: string; bankDetails: Record<string, string> }>;
  /** Instruct the agent to pay the seller. PENDING = the agent will confirm by webhook. */
  release(agentRef: string, m: EscrowMilestoneInfo): Promise<{ status: "RELEASED" | "PENDING" }>;
  refund(agentRef: string, m: EscrowMilestoneInfo): Promise<{ status: "REFUNDED" | "PENDING" }>;
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  /** Agent-specific payload -> { type: escrow.funded|escrow.released|escrow.refunded, id, data:{agent_ref, milestone_ref} }. */
  normalizeWebhook?(payload: unknown): { id: string; type: string; data: Record<string, unknown> } | null;
}

/** Sandbox agent: deterministic, no network, no money. Test mode only. */
export class MockEscrowAgent implements EscrowAgent {
  readonly id = "mock_escrow";
  async createEscrow(deal: EscrowDealInfo) { return { agentRef: `mock_esc_${deal.id.slice(-8)}` }; }
  async fundingInstructions(deal: EscrowDealInfo, m: EscrowMilestoneInfo, agentRef: string) {
    const reference = `${agentRef}-M${m.seq}`;
    return { reference, bankDetails: { account_name: "Mock Escrow Agent (test)", iban_or_account: `MOCKESC${deal.id.slice(-6).toUpperCase()}`, currency: deal.currency, reference } };
  }
  async release() { return { status: "RELEASED" as const }; }
  async refund() { return { status: "REFUNDED" as const }; }
  verifyWebhook(raw: string, headers: Headers) {
    const given = Buffer.from(headers.get("x-partner-signature") ?? ""), want = Buffer.from(createHmac("sha256", mockWebhookSecret()).update(raw).digest("hex"));
    return given.length === want.length && timingSafeEqual(given, want);
  }
}

export class EscrowNotConfigured extends Error {}

/** Test-mode organisations always get the mock agent; live organisations need a configured, licensed agent (none ships here). */
export function getEscrowAgent(sandbox: boolean, id?: string): EscrowAgent {
  if (sandbox) return new MockEscrowAgent();
  const want = id ?? process.env.ESCROW_AGENT;
  throw new EscrowNotConfigured(want
    ? `Escrow agent "${want}" has no adapter in this deployment`
    : "No licensed escrow agent is configured. Live escrow needs a contract with one; use pay-on-approval milestones until then.");
}

/** Webhook route: agent id from the URL -> adapter (mock only in this build). */
export function getEscrowAgentForWebhook(id: string): EscrowAgent | null {
  return id === "mock_escrow" ? new MockEscrowAgent() : null;
}
