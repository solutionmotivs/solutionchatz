// Escrow / milestone deal state machine. Every transition is guarded (right actor, right state) and logged to the deal timeline.
// Money rules: Vaulte never holds funds. PARTNER_ESCROW: the agent holds and releases. PAY_ON_APPROVAL: no one holds funds;
// the milestone is invoiced when approved, and "released" means the buyer's payment completed.
import type { EscrowDeal, EscrowMilestone, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isSanctionedCountry } from "@/lib/compliance/aml";
import { sendEmail } from "@/lib/email/sender";
import type { EmailTemplate } from "@/lib/email/templates";
import { createInvoice, invoiceUrls } from "@/lib/invoices/service";
import { screenName } from "@/lib/sanctions/screen";
import { emitWebhookEvent } from "@/lib/webhooks/dispatch";
import { getEscrowAgent, EscrowNotConfigured, type EscrowDealInfo, type EscrowMilestoneInfo } from "./agent";

export class EscrowError extends Error {
  constructor(public code: string, message: string, public status = 400, public param?: string) { super(message); }
}

export type Mode = "PARTNER_ESCROW" | "PAY_ON_APPROVAL";
type Actor = "SELLER" | "BUYER" | "STAFF" | "SYSTEM" | "AGENT";
type Deal = EscrowDeal & { milestones: EscrowMilestone[] };
const TERMINAL = new Set(["RELEASED", "REFUNDED", "CANCELLED"]);

export const DISCLOSURE: Record<Mode, string> = {
  PARTNER_ESCROW: "The buyer's money is held by a licensed escrow agent, not by Vaulte or the seller, and is released to the seller when the buyer approves a delivery or a dispute is resolved. Vaulte does not hold funds.",
  PAY_ON_APPROVAL: "This is milestone billing, not escrow: nobody holds the buyer's money. When the buyer approves a delivery, the buyer is invoiced for that milestone and pays through Vaulte's licensed partners. The seller is not guaranteed payment, and the buyer is not protected by a held deposit (except for milestones marked pay-upfront, which the buyer pays at the start).",
};

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const mail = (subject: string, text: string, link?: string): EmailTemplate => ({
  subject, text: link ? `${text}\n\n${link}` : text,
  html: `<p style="font-family:sans-serif;font-size:14px;line-height:1.5">${esc(text).replace(/\n/g, "<br>")}</p>${link ? `<p><a href="${esc(link)}">${esc(link)}</a></p>` : ""}`,
});
const base = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
export const dealLink = (token: string) => `${base()}/escrow/${token}`;

async function log(dealId: string, actor: Actor, type: string, note?: string | null, milestoneId?: string | null, tx: Prisma.TransactionClient | typeof db = db) {
  await tx.escrowEvent.create({ data: { dealId, milestoneId: milestoneId ?? null, actor, type, note: note ?? null } });
}

export async function loadDeal(where: { id?: string; publicToken?: string; organizationId?: string }): Promise<Deal | null> {
  return db.escrowDeal.findFirst({ where, include: { milestones: { orderBy: { seq: "asc" } } } });
}

const isSandboxOrg = async (organizationId: string) => (await db.organization.findUnique({ where: { id: organizationId }, select: { kybStatus: true } }))?.kybStatus !== "APPROVED";

// ── Create ───────────────────────────────────────────────────────────────────────

export interface CreateDealInput {
  title: string; description?: string; terms: string; mode: Mode; currency: string; approvalWindowDays?: number; purposeCode?: string;
  sellerEntityId?: string; buyerName: string; buyerEmail: string; buyerCountry: string;
  milestones: { title: string; description?: string; amount: number; payTiming?: "UPFRONT" | "ON_APPROVAL"; dueDate?: string }[];
}

export async function createDeal(organizationId: string, i: CreateDealInput): Promise<Deal> {
  if (!i.milestones.length) throw new EscrowError("VALIDATION_ERROR", "Add at least one milestone", 400, "milestones");
  if (i.milestones.some(m => !Number.isInteger(m.amount) || m.amount <= 0)) throw new EscrowError("VALIDATION_ERROR", "Milestone amounts must be positive whole minor units", 400, "milestones");
  if (isSanctionedCountry(i.buyerCountry)) throw new EscrowError("NOT_AVAILABLE", "Deals with parties in this country are not supported", 422, "buyer_country");
  const entities = await db.entity.findMany({ where: { organizationId }, select: { id: true, legalName: true, country: true, entityType: true }, take: 50 });
  const seller = i.sellerEntityId ? entities.find(e => e.id === i.sellerEntityId) : entities.length === 1 ? entities[0] : undefined;
  if (!seller) throw new EscrowError("PAYEE_REQUIRED", "Say who gets paid: pass seller_entity_id (your organisation has more than one entity, or none yet)", 400, "seller_entity_id");
  if (seller.country === "IN" && seller.entityType === "BUSINESS" && !i.purposeCode) throw new EscrowError("PURPOSE_REQUIRED", "An Indian business seller needs an RBI purpose code (e.g. P0802) for the milestone invoices", 400, "purpose_code");
  const sandbox = await isSandboxOrg(organizationId);
  if (i.mode === "PARTNER_ESCROW") {
    try { getEscrowAgent(sandbox); } catch (e) { if (e instanceof EscrowNotConfigured) throw new EscrowError("ESCROW_NOT_AVAILABLE", e.message, 409, "mode"); throw e; }
  }
  // Screen the buyer before anything is sent to them: a possible match stops the deal for staff review.
  const sc = await screenName({ name: i.buyerName, kind: "ENTITY", country: i.buyerCountry }, { organizationId, subjectType: "TRANSFER_PARTY" });
  if (sc.outcome === "BLOCK") throw new EscrowError("SANCTIONS_HOLD", "This deal cannot be created for the named buyer", 422);
  const deal = await db.escrowDeal.create({
    data: {
      title: i.title, description: i.description ?? null, terms: i.terms, mode: i.mode, currency: i.currency, organizationId, sellerEntityId: seller.id,
      approvalWindowDays: i.approvalWindowDays ?? 7, purposeCode: i.purposeCode ?? null, buyerName: i.buyerName, buyerEmail: i.buyerEmail.toLowerCase(), buyerCountry: i.buyerCountry, buyerScreening: sc.outcome === "CLEAR" ? "CLEAR" : "REVIEW",
      milestones: { create: i.milestones.map((m, n) => ({ seq: n + 1, title: m.title, description: m.description ?? null, amount: BigInt(m.amount), payTiming: i.mode === "PAY_ON_APPROVAL" ? m.payTiming ?? "ON_APPROVAL" : "ON_APPROVAL", dueDate: m.dueDate ? new Date(m.dueDate) : null })) },
    },
    include: { milestones: { orderBy: { seq: "asc" } } },
  });
  await log(deal.id, "SELLER", "DEAL_CREATED", `${i.mode}, ${i.milestones.length} milestone(s)`);
  await emitWebhookEvent({ organizationId, event: "escrow.deal_created", data: { deal_id: deal.id, mode: deal.mode } }).catch(() => {});
  return deal;
}

/** Email the buyer their link. A buyer flagged REVIEW cannot be contacted until staff clear the screening. */
export async function sendDeal(organizationId: string, id: string): Promise<{ link: string }> {
  const d = await loadDeal({ id, organizationId });
  if (!d) throw new EscrowError("NOT_FOUND", "Deal not found", 404);
  if (!["DRAFT", "AWAITING_BUYER"].includes(d.status)) throw new EscrowError("INVALID_STATE", `A ${d.status.toLowerCase()} deal cannot be sent`, 409);
  if (d.buyerScreening !== "CLEAR") throw new EscrowError("SANCTIONS_HOLD", "The buyer is under review; this deal cannot be sent yet", 409);
  const seller = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  await db.escrowDeal.update({ where: { id }, data: { status: "AWAITING_BUYER" } });
  await log(id, "SELLER", "DEAL_SENT", d.buyerEmail);
  const link = dealLink(d.publicToken);
  await sendEmail({ to: d.buyerEmail, organizationId, template: mail(`${seller?.name ?? "A supplier"} sent you a deal: ${d.title}`, `${seller?.name ?? "A supplier"} proposed "${d.title}" with ${d.milestones.length} milestone(s).\n\n${DISCLOSURE[d.mode as Mode]}\n\nReview the terms and accept or decline here:`, link) }).catch(() => {});
  return { link };
}

// ── Buyer accepts ────────────────────────────────────────────────────────────────

const infoOf = async (d: Deal): Promise<{ deal: EscrowDealInfo; ms: EscrowMilestoneInfo[] }> => {
  const seller = await db.entity.findUnique({ where: { id: d.sellerEntityId }, select: { legalName: true, country: true } });
  return { deal: { id: d.id, currency: d.currency, title: d.title, buyerName: d.buyerName, buyerEmail: d.buyerEmail, buyerCountry: d.buyerCountry, sellerName: seller?.legalName ?? "", sellerCountry: seller?.country ?? "" }, ms: d.milestones.map(m => ({ id: m.id, seq: m.seq, title: m.title, amountMinor: m.amount })) };
};

export async function acceptDeal(token: string): Promise<Deal> {
  const d = await loadDeal({ publicToken: token });
  if (!d) throw new EscrowError("NOT_FOUND", "Deal not found", 404);
  if (d.status === "ACTIVE") return d;
  if (d.status !== "AWAITING_BUYER") throw new EscrowError("INVALID_STATE", "This deal is not open for acceptance", 409);
  const sandbox = await isSandboxOrg(d.organizationId);
  let agentId: string | null = null, agentRef: string | null = null;
  if (d.mode === "PARTNER_ESCROW") {
    const agent = getEscrowAgent(sandbox, d.agent ?? undefined);
    const { deal, ms } = await infoOf(d);
    agentRef = (await agent.createEscrow(deal, ms)).agentRef; agentId = agent.id;
  }
  await db.escrowDeal.update({ where: { id: d.id }, data: { status: "ACTIVE", acceptedAt: new Date(), agent: agentId, agentRef } });
  await log(d.id, "BUYER", "DEAL_ACCEPTED");
  // Prepaid milestones are invoiced right away in pay-on-approval mode.
  if (d.mode === "PAY_ON_APPROVAL") for (const m of d.milestones.filter(x => x.payTiming === "UPFRONT")) await invoiceMilestone(d, m, "UPFRONT");
  await emitWebhookEvent({ organizationId: d.organizationId, event: "escrow.deal_accepted", data: { deal_id: d.id } }).catch(() => {});
  return (await loadDeal({ id: d.id }))!;
}

export async function declineDeal(token: string, note?: string) {
  const d = await loadDeal({ publicToken: token });
  if (!d) throw new EscrowError("NOT_FOUND", "Deal not found", 404);
  if (d.status !== "AWAITING_BUYER") throw new EscrowError("INVALID_STATE", "This deal is not open", 409);
  await db.escrowDeal.update({ where: { id: d.id }, data: { status: "CANCELLED" } });
  await log(d.id, "BUYER", "DEAL_DECLINED", note);
}

/** Pay-on-approval: raise the invoice for a milestone and email the buyer the pay link. */
async function invoiceMilestone(d: Deal, m: EscrowMilestone, when: "UPFRONT" | "APPROVAL") {
  if (m.invoiceId) return;
  const inv = await createInvoice(d.organizationId, {
    currency: d.currency, issuerEntityId: d.sellerEntityId, payerName: d.buyerName, payerEmail: d.buyerEmail, reference: `deal:${d.id.slice(-8)}#${m.seq}`,
    lines: [{ description: `${d.title}: ${m.title}`, quantity: 1, unit_price: Number(m.amount), tax_rate: 0 }], source: "PAYMENT_LINK", prefix: "ES", purposeCode: d.purposeCode ?? undefined,
    notes: `Milestone ${m.seq} of deal "${d.title}"${when === "UPFRONT" ? " (paid upfront)" : " (approved by the buyer)"}.`,
  });
  await db.invoice.update({ where: { id: inv.id }, data: { status: "SENT" } });
  await db.escrowMilestone.update({ where: { id: m.id }, data: { invoiceId: inv.id } });
  await log(d.id, "SYSTEM", "INVOICE_CREATED", inv.number, m.id);
  await sendEmail({ to: d.buyerEmail, organizationId: d.organizationId, template: mail(`Pay milestone ${m.seq}: ${d.title}`, when === "UPFRONT" ? `Milestone ${m.seq} ("${m.title}") is paid upfront. Pay it here to start the work:` : `You approved milestone ${m.seq} ("${m.title}"). Pay it here:`, invoiceUrls(inv.publicToken).pay_url) }).catch(() => {});
}

// ── Funding (agent mode) ─────────────────────────────────────────────────────────

export async function fundingFor(token: string, milestoneId: string) {
  const d = await loadDeal({ publicToken: token });
  if (!d || d.mode !== "PARTNER_ESCROW") throw new EscrowError("NOT_FOUND", "Deal not found", 404);
  const m = d.milestones.find(x => x.id === milestoneId);
  if (!m) throw new EscrowError("NOT_FOUND", "Milestone not found", 404);
  if (d.status !== "ACTIVE" || m.status !== "PENDING") throw new EscrowError("INVALID_STATE", "This milestone is not waiting for funds", 409);
  const agent = getEscrowAgent(await isSandboxOrg(d.organizationId), d.agent ?? undefined);
  const { deal } = await infoOf(d);
  return agent.fundingInstructions(deal, { id: m.id, seq: m.seq, title: m.title, amountMinor: m.amount }, d.agentRef!);
}

/** Agent says the milestone is funded / released / refunded (signed webhook). Idempotent. */
export async function onAgentEvent(type: string, agentRef: string, milestoneRef: string): Promise<boolean> {
  const d = await db.escrowDeal.findFirst({ where: { agentRef }, include: { milestones: true } });
  if (!d) return false;
  const m = d.milestones.find(x => x.id === milestoneRef || `${agentRef}-M${x.seq}` === milestoneRef);
  if (!m) return false;
  if (type === "escrow.funded") {
    if (m.status !== "PENDING") return true;
    await db.escrowMilestone.update({ where: { id: m.id }, data: { status: "FUNDED" } });
    await log(d.id, "AGENT", "MILESTONE_FUNDED", null, m.id);
    await sendEmail({ to: (await sellerEmail(d.organizationId)) ?? d.buyerEmail, organizationId: d.organizationId, template: mail(`Milestone ${m.seq} funded: ${d.title}`, `The escrow agent confirms milestone ${m.seq} ("${m.title}") is funded. You can start the work and submit it for approval.`, `${base()}/dashboard/escrow`) }).catch(() => {});
    return true;
  }
  if (type === "escrow.released") { await markReleased(d.id, m.id, "AGENT"); return true; }
  if (type === "escrow.refunded") { await markRefunded(d.id, m.id, "AGENT", null); return true; }
  return false;
}

const sellerEmail = async (organizationId: string) => (await db.user.findFirst({ where: { organizationId, role: "OWNER" }, select: { email: true }, orderBy: { createdAt: "asc" } }))?.email;

// ── Delivery, approval, dispute ──────────────────────────────────────────────────

async function settleIfDone(dealId: string) {
  const d = await loadDeal({ id: dealId });
  if (d && d.status === "ACTIVE" && d.milestones.every(m => TERMINAL.has(m.status))) {
    await db.escrowDeal.update({ where: { id: dealId }, data: { status: "COMPLETED" } });
    await log(dealId, "SYSTEM", "DEAL_COMPLETED");
    await emitWebhookEvent({ organizationId: d.organizationId, event: "escrow.deal_completed", data: { deal_id: dealId } }).catch(() => {});
  }
}

async function markReleased(dealId: string, milestoneId: string, actor: Actor) {
  const r = await db.escrowMilestone.updateMany({ where: { id: milestoneId, status: { in: ["APPROVED", "FUNDED", "SUBMITTED", "DISPUTED", "PENDING"] } }, data: { status: "RELEASED", releasedAt: new Date() } });
  if (!r.count) return;
  await log(dealId, actor, "MILESTONE_RELEASED", null, milestoneId);
  const d = await loadDeal({ id: dealId });
  if (d) await emitWebhookEvent({ organizationId: d.organizationId, event: "escrow.milestone_released", data: { deal_id: dealId, milestone_id: milestoneId } }).catch(() => {});
  await settleIfDone(dealId);
}

async function markRefunded(dealId: string, milestoneId: string, actor: Actor, note: string | null) {
  const r = await db.escrowMilestone.updateMany({ where: { id: milestoneId, status: { in: ["FUNDED", "SUBMITTED", "DISPUTED", "APPROVED", "PENDING"] } }, data: { status: "REFUNDED" } });
  if (!r.count) return;
  await log(dealId, actor, "MILESTONE_REFUNDED", note, milestoneId);
  await settleIfDone(dealId);
}

export async function submitMilestone(organizationId: string, dealId: string, milestoneId: string, note?: string) {
  const d = await loadDeal({ id: dealId, organizationId });
  const m = d?.milestones.find(x => x.id === milestoneId);
  if (!d || !m) throw new EscrowError("NOT_FOUND", "Milestone not found", 404);
  if (d.status !== "ACTIVE") throw new EscrowError("INVALID_STATE", "The deal is not active", 409);
  // Escrow: work starts once the agent confirms funds. Pay-on-approval: prepaid milestones need their payment first.
  const ready = d.mode === "PARTNER_ESCROW" ? m.status === "FUNDED" : m.payTiming === "UPFRONT" ? m.status === "FUNDED" : m.status === "PENDING";
  if (!ready) throw new EscrowError("INVALID_STATE", d.mode === "PARTNER_ESCROW" || m.payTiming === "UPFRONT" ? "This milestone is not funded yet" : "This milestone cannot be submitted now", 409);
  await db.escrowMilestone.update({ where: { id: m.id }, data: { status: "SUBMITTED", submittedAt: new Date(), submissionNote: note?.slice(0, 1000) ?? null } });
  await log(d.id, "SELLER", "MILESTONE_SUBMITTED", note, m.id);
  await sendEmail({ to: d.buyerEmail, organizationId, template: mail(`Delivery ready for approval: ${d.title}, milestone ${m.seq}`, `The seller submitted milestone ${m.seq} ("${m.title}").\n${note ? `Note: ${note}\n` : ""}Approve it, or open a dispute. If you do nothing for ${d.approvalWindowDays} days it is treated as approved, as set out in the deal terms.`, dealLink(d.publicToken)) }).catch(() => {});
}

export async function approveMilestone(milestoneId: string, by: "BUYER" | "SYSTEM" | "STAFF", token?: string, staffNote?: string) {
  const m = await db.escrowMilestone.findUnique({ where: { id: milestoneId }, include: { deal: { include: { milestones: true } } } });
  if (!m || (token && m.deal.publicToken !== token)) throw new EscrowError("NOT_FOUND", "Milestone not found", 404);
  const d = m.deal as Deal;
  if (d.status !== "ACTIVE") throw new EscrowError("INVALID_STATE", "The deal is not active", 409);
  const from = by === "STAFF" ? "DISPUTED" : "SUBMITTED";
  if (m.status !== from) throw new EscrowError("INVALID_STATE", `Only a ${from.toLowerCase()} milestone can be approved`, 409);
  const claimed = await db.escrowMilestone.updateMany({ where: { id: m.id, status: from }, data: { status: "APPROVED", approvedAt: new Date(), approvedBy: by } });
  if (!claimed.count) return; // someone else just did it
  await log(d.id, by, by === "SYSTEM" ? "DEEMED_APPROVED" : "MILESTONE_APPROVED", staffNote ?? null, m.id);
  if (d.mode === "PARTNER_ESCROW") {
    const agent = getEscrowAgent(await isSandboxOrg(d.organizationId), d.agent ?? undefined);
    const res = await agent.release(d.agentRef!, { id: m.id, seq: m.seq, title: m.title, amountMinor: m.amount });
    if (res.status === "RELEASED") await markReleased(d.id, m.id, "AGENT");
  } else if (m.payTiming === "UPFRONT") {
    await markReleased(d.id, m.id, "SYSTEM"); // the buyer already paid at the start
  } else {
    await invoiceMilestone(d, m, "APPROVAL");
  }
}

export async function disputeMilestone(milestoneId: string, by: "BUYER" | "SELLER", reason: string, ref: { token?: string; organizationId?: string }) {
  const m = await db.escrowMilestone.findUnique({ where: { id: milestoneId }, include: { deal: true } });
  if (!m || (ref.token ? m.deal.publicToken !== ref.token : m.deal.organizationId !== ref.organizationId)) throw new EscrowError("NOT_FOUND", "Milestone not found", 404);
  if (m.deal.status !== "ACTIVE") throw new EscrowError("INVALID_STATE", "The deal is not active", 409);
  if (!["FUNDED", "SUBMITTED"].includes(m.status) && !(m.deal.mode === "PAY_ON_APPROVAL" && m.status === "PENDING" && by === "BUYER")) throw new EscrowError("INVALID_STATE", "This milestone cannot be disputed in its current state", 409);
  if (reason.trim().length < 10) throw new EscrowError("VALIDATION_ERROR", "Describe the problem (at least 10 characters)", 400, "reason");
  await db.escrowMilestone.update({ where: { id: m.id }, data: { status: "DISPUTED", disputeReason: reason.trim().slice(0, 1500), disputeOpenedBy: by, disputeOpenedAt: new Date() } });
  await log(m.dealId, by, "DISPUTE_OPENED", reason.trim().slice(0, 300), m.id);
  await emitWebhookEvent({ organizationId: m.deal.organizationId, event: "escrow.dispute_opened", data: { deal_id: m.dealId, milestone_id: m.id, opened_by: by } }).catch(() => {});
  if (process.env.OPS_EMAIL) await sendEmail({ to: process.env.OPS_EMAIL, template: mail(`Escrow dispute: ${m.deal.title}`, `Milestone ${m.seq} was disputed by the ${by.toLowerCase()}.\nReason: ${reason.slice(0, 500)}\nResolve it in the staff dispute queue.`) }).catch(() => {});
}

/** Staff decide a dispute. RELEASE = pay the seller; REFUND = return to the buyer (agent mode) / cancel the milestone (pay-on-approval). */
export async function resolveDispute(milestoneId: string, staffId: string, resolution: "RELEASE" | "REFUND", note: string) {
  if (note.trim().length < 10) throw new EscrowError("VALIDATION_ERROR", "Record the reasoning (at least 10 characters)", 400, "note");
  const m = await db.escrowMilestone.findUnique({ where: { id: milestoneId }, include: { deal: { include: { milestones: true } } } });
  if (!m) throw new EscrowError("NOT_FOUND", "Milestone not found", 404);
  if (m.status !== "DISPUTED") throw new EscrowError("INVALID_STATE", "This milestone is not in dispute", 409);
  const d = m.deal as Deal;
  await db.escrowMilestone.update({ where: { id: m.id }, data: { resolution, resolutionNote: note.trim().slice(0, 1500), resolvedById: staffId, resolvedAt: new Date() } });
  await log(d.id, "STAFF", `DISPUTE_RESOLVED_${resolution}`, note.trim().slice(0, 300), m.id);
  if (resolution === "RELEASE") return approveMilestone(m.id, "STAFF", undefined, note);
  const info: EscrowMilestoneInfo = { id: m.id, seq: m.seq, title: m.title, amountMinor: m.amount };
  if (d.mode === "PARTNER_ESCROW") {
    const res = await getEscrowAgent(await isSandboxOrg(d.organizationId), d.agent ?? undefined).refund(d.agentRef!, info);
    if (res.status === "REFUNDED") await markRefunded(d.id, m.id, "AGENT", note);
  } else {
    // Nothing is held. A prepaid amount that was already paid is returned by the payment partner outside Vaulte: staff arrange that.
    await markRefunded(d.id, m.id, "STAFF", m.payTiming === "UPFRONT" && m.invoiceId ? `${note} (prepaid amount to be returned via the payment partner)` : note);
  }
}

/** The pay-on-approval invoice for a milestone was paid. */
export async function onInvoicePaid(invoiceId: string): Promise<void> {
  const m = await db.escrowMilestone.findFirst({ where: { invoiceId }, include: { deal: true } });
  if (!m) return;
  if (m.status === "APPROVED") await markReleased(m.dealId, m.id, "SYSTEM");
  else if (m.status === "PENDING" && m.payTiming === "UPFRONT") {
    await db.escrowMilestone.update({ where: { id: m.id }, data: { status: "FUNDED" } });
    await log(m.dealId, "SYSTEM", "MILESTONE_PAID_UPFRONT", null, m.id);
  }
}

export async function cancelDeal(organizationId: string, id: string) {
  const d = await loadDeal({ id, organizationId });
  if (!d) throw new EscrowError("NOT_FOUND", "Deal not found", 404);
  if (!["DRAFT", "AWAITING_BUYER", "ACTIVE"].includes(d.status)) throw new EscrowError("INVALID_STATE", `A ${d.status.toLowerCase()} deal cannot be cancelled`, 409);
  if (d.milestones.some(m => !["PENDING", "CANCELLED"].includes(m.status) || (m.status === "PENDING" && m.invoiceId))) throw new EscrowError("MONEY_IN_FLIGHT", "A milestone already has money or work in progress; resolve it first", 409);
  await db.escrowMilestone.updateMany({ where: { dealId: id }, data: { status: "CANCELLED" } });
  await db.escrowDeal.update({ where: { id }, data: { status: "CANCELLED" } });
  await log(id, "SELLER", "DEAL_CANCELLED");
}

/** Cron: silence after the approval window counts as approval (the window is shown to the buyer in the terms and in every reminder). */
export async function runDeemedApprovals(now = new Date()): Promise<number> {
  const due = await db.escrowMilestone.findMany({ where: { status: "SUBMITTED", submittedAt: { not: null }, deal: { status: "ACTIVE" } }, include: { deal: { select: { approvalWindowDays: true } } }, take: 200 });
  let n = 0;
  for (const m of due) {
    if (m.submittedAt!.getTime() + m.deal.approvalWindowDays * 86400_000 > now.getTime()) continue;
    try { await approveMilestone(m.id, "SYSTEM"); n++; } catch { /* another actor got there first */ }
  }
  return n;
}

export const presentMilestone = (m: EscrowMilestone) => ({
  id: m.id, seq: m.seq, title: m.title, description: m.description, amount: Number(m.amount), pay_timing: m.payTiming, status: m.status, due_date: m.dueDate?.toISOString() ?? null,
  submitted_at: m.submittedAt?.toISOString() ?? null, submission_note: m.submissionNote, approved_at: m.approvedAt?.toISOString() ?? null, approved_by: m.approvedBy, released_at: m.releasedAt?.toISOString() ?? null,
  invoice_id: m.invoiceId, dispute: m.disputeReason ? { reason: m.disputeReason, opened_by: m.disputeOpenedBy, opened_at: m.disputeOpenedAt?.toISOString() ?? null, resolution: m.resolution, resolution_note: m.resolutionNote } : null,
});
export const presentDeal = (d: Deal, events?: { createdAt: Date; actor: string; type: string; note: string | null }[]) => ({
  id: d.id, title: d.title, description: d.description, terms: d.terms, mode: d.mode, status: d.status, currency: d.currency, approval_window_days: d.approvalWindowDays,
  buyer: { name: d.buyerName, email: d.buyerEmail, country: d.buyerCountry }, screening: d.buyerScreening, agent: d.agent, accepted_at: d.acceptedAt?.toISOString() ?? null, created_at: d.createdAt.toISOString(),
  total: d.milestones.reduce((s, m) => s + Number(m.amount), 0), disclosure: DISCLOSURE[d.mode as Mode], link: dealLink(d.publicToken),
  milestones: d.milestones.map(presentMilestone), ...(events ? { timeline: events.map(e => ({ at: e.createdAt.toISOString(), actor: e.actor, type: e.type, note: e.note })) } : {}),
});
