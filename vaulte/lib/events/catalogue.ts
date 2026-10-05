// Every event Vaulte can send to your webhook endpoints. Names are stable; payloads only ever gain fields.
export interface EventDef { name: string; description: string; sample: Record<string, unknown> }

export const EVENTS: EventDef[] = [
  { name: "transfer.created", description: "A transfer was created from a quote.", sample: { transfer_id: "cm...", status: "AWAITING_FUNDS" } },
  { name: "transfer.funded", description: "The partner confirmed the sender's funds arrived.", sample: { transfer_id: "cm..." } },
  { name: "transfer.completed", description: "The recipient was paid. Carries the eFIRA reference when the partner supplied one.", sample: { transfer_id: "cm...", efira_ref: "EFIRA-123" } },
  { name: "transfer.failed", description: "The transfer failed; booked amounts were reversed and the partner refunds the sender.", sample: { transfer_id: "cm...", reason: "partner payout failed" } },
  { name: "invoice.created", description: "An invoice was created.", sample: { invoice_id: "cm..." } },
  { name: "invoice.paid", description: "An invoice was settled by a completed transfer.", sample: { invoice_id: "cm...", transfer_id: "cm..." } },
  { name: "virtual_account.credited", description: "A virtual account received a credit that was swept.", sample: { virtual_account_id: "cm...", transfer_id: "cm..." } },
  { name: "kyb.approved", description: "Business verification approved.", sample: { case_id: "cm...", status: "APPROVED", tier: "CDD" } },
  { name: "kyb.rejected", description: "Business verification not approved.", sample: { case_id: "cm...", status: "REJECTED" } },
  { name: "kyb.needs_info", description: "Business verification needs more information.", sample: { case_id: "cm...", status: "NEEDS_INFO" } },
  { name: "kyc.approved", description: "Identity verification approved.", sample: { case_id: "cm...", status: "APPROVED", tier: "SDD" } },
  { name: "kyc.rejected", description: "Identity verification not approved.", sample: { case_id: "cm...", status: "REJECTED" } },
  { name: "kyc.needs_info", description: "Identity verification needs more information.", sample: { case_id: "cm...", status: "NEEDS_INFO" } },
  { name: "compliance.flagged", description: "A transfer or party was put on hold for compliance review.", sample: { transfer_id: "cm...", reason: "SANCTIONS_REVIEW" } },
  { name: "document.requested", description: "A certificate (eFIRA, FIRC, eBRC, BRC, bank certificate) was requested for a completed transfer.", sample: { request_id: "cm...", type: "EBRC", transfer_id: "cm..." } },
  { name: "document.received", description: "A certificate or document was added to a transfer.", sample: { document_id: "cm...", type: "EFIRA", transfer_id: "cm...", status: "VERIFIED" } },
  { name: "document.verified", description: "Staff verified or rejected an uploaded document.", sample: { document_id: "cm...", status: "VERIFIED" } },
  { name: "ledger.journal.posted", description: "A journal was posted to the ledger for your account (for accounting sync).", sample: { journal_id: "cm...", seq: 42, kind: "MEMO_PAYOUT", transfer_id: "cm...", lines: [] } },
  { name: "erp.sync_completed", description: "Transfers were pushed to your accounting system.", sample: { provider: "QUICKBOOKS", synced: 3 } },
  { name: "erp.sync_failed", description: "A transfer could not be pushed to your accounting system.", sample: { provider: "XERO", transfer_id: "cm...", error: "..." } },
];

export const EVENT_NAMES = EVENTS.map(e => e.name);
