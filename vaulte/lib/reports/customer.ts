// Customer-facing reports (account statement, settlements) in CSV, XML and PDF. These are Vaulte's records of the customer's
// transfers: not bank statements, and never presented as certificates.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { db } from "@/lib/db";
import { clean, Writer } from "@/lib/documents/pdf";
import { customerStatement, major, toCsv } from "@/lib/ledger/reports";
import { toXml } from "./xml";

export type Format = "json" | "csv" | "xml" | "pdf";
export const FORMATS: Format[] = ["json", "csv", "xml", "pdf"];
export const parseFormat = (v: string | null): Format | null => (v === null ? "json" : (FORMATS as string[]).includes(v) ? (v as Format) : null);

export const REPORT_NOTE = "Customer funds are held by licensed partners; Vaulte does not hold them. This is Vaulte's record of your transfers, not a bank statement and not an eFIRA, FIRC, eBRC or other certificate.";

export function parseRange(q: URLSearchParams): { from: Date; to: Date } | { error: string } {
  const to = q.get("to") ? new Date(q.get("to")!) : new Date();
  const from = q.get("from") ? new Date(q.get("from")!) : new Date(to.getTime() - 31 * 86400000);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return { error: "from/to must be dates" };
  if (from > to) return { error: "from must be before to" };
  return { from, to };
}

const dec = (c: string) => (["JPY", "KRW", "VND", "CLP"].includes(c) ? 0 : 2);
const fmtMinor = (m: bigint, c: string) => major(m, c);

// ── Statement ────────────────────────────────────────────────────────────────────

export async function statementData(organizationId: string, from: Date, to: Date) {
  const s = await customerStatement(organizationId, from, to);
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, legalName: true } });
  const totals: Record<string, { received: bigint; paid_out_or_fees: bigint; closing: bigint }> = {};
  for (const [c, v] of Object.entries(s.opening)) totals[c] = { received: 0n, paid_out_or_fees: 0n, closing: v as bigint };
  for (const l of s.lines) {
    const t = (totals[l.currency] ??= { received: 0n, paid_out_or_fees: 0n, closing: 0n });
    t.received += l.received; t.paid_out_or_fees += l.paid_out_or_fees; t.closing = l.open_obligation_after;
  }
  return { ...s, account: org?.legalName ?? org?.name ?? organizationId, totals, generated_at: new Date().toISOString() };
}
type StatementData = Awaited<ReturnType<typeof statementData>>;

const stmtRow = (l: StatementData["lines"][number]) => [l.date, l.reference ?? "", l.description, l.currency, fmtMinor(l.received, l.currency), fmtMinor(l.paid_out_or_fees, l.currency), fmtMinor(l.open_obligation_after, l.currency), l.transfer_status ?? "", l.partner_ref ?? ""];
const STMT_HEAD = ["date", "reference", "description", "currency", "received", "paid_out_or_fees", "open_obligation_after", "transfer_status", "partner_ref"];

export async function renderStatement(d: StatementData, format: Format): Promise<{ body: BodyInit; type: string; ext: string }> {
  if (format === "csv") return { body: toCsv(STMT_HEAD, d.lines.map(stmtRow)), type: "text/csv; charset=utf-8", ext: "csv" };
  if (format === "xml") {
    return { type: "application/xml; charset=utf-8", ext: "xml", body: toXml("VaulteStatement", {
      "@version": "1.0", "@generated": d.generated_at, Account: d.account, Period: { From: d.from, To: d.to }, Note: REPORT_NOTE,
      OpeningBalances: { Balance: Object.entries(d.opening).map(([c, v]) => ({ "@currency": c, Amount: fmtMinor(v as bigint, c) })) },
      Lines: { Line: d.lines.map(l => ({ Date: l.date, Reference: l.reference ?? "", Description: l.description, Currency: l.currency, Received: fmtMinor(l.received, l.currency), PaidOutOrFees: fmtMinor(l.paid_out_or_fees, l.currency), OpenObligationAfter: fmtMinor(l.open_obligation_after, l.currency), TransferStatus: l.transfer_status ?? "", PartnerRef: l.partner_ref ?? "" })) },
      Totals: { Total: Object.entries(d.totals).map(([c, t]) => ({ "@currency": c, Received: fmtMinor(t.received, c), PaidOutOrFees: fmtMinor(t.paid_out_or_fees, c), Closing: fmtMinor(t.closing, c) })) },
    }) };
  }
  const pdf = await newPdf("Account statement");
  const w = pdf.w;
  w.h1("Account statement");
  w.kv([["Account", d.account], ["Period", `${d.from.slice(0, 10)} to ${d.to.slice(0, 10)}`], ["Generated", d.generated_at.replace("T", " ").slice(0, 19) + " UTC"]]);
  w.h2("Summary by currency");
  w.table(["Currency", "Opening", "Received", "Fees / paid out", "Closing"], Object.entries(d.totals).map(([c, t]) => [c, fmtMinor((d.opening[c] as bigint | undefined) ?? 0n, c), fmtMinor(t.received, c), fmtMinor(t.paid_out_or_fees, c), fmtMinor(t.closing, c)]), [90, 100, 100, 110, 93]);
  w.h2("Activity");
  w.table(["Date", "Ref", "Description", "Ccy", "Received", "Out/fees", "Open after"], d.lines.map(l => [l.date.slice(0, 10), (l.reference ?? "").slice(-8), l.description, l.currency, fmtMinor(l.received, l.currency), fmtMinor(l.paid_out_or_fees, l.currency), fmtMinor(l.open_obligation_after, l.currency)]), [62, 52, 150, 32, 70, 70, 61]);
  w.p(REPORT_NOTE, 8);
  return { body: Buffer.from(await pdf.doc.save()), type: "application/pdf", ext: "pdf" };
}

// ── Settlements ──────────────────────────────────────────────────────────────────

export async function settlementsData(organizationId: string, from: Date, to: Date) {
  const rows = await db.transfer.findMany({ where: { organizationId, createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "asc" }, take: 5000, include: { sender: { select: { legalName: true } }, recipient: { select: { legalName: true } } } });
  const invoices = await db.invoice.findMany({ where: { id: { in: rows.map(r => r.invoiceId).filter((x): x is string => !!x) } }, select: { id: true, number: true } });
  const inv = new Map(invoices.map(i => [i.id, i.number]));
  const docs = await db.document.findMany({ where: { transferId: { in: rows.map(r => r.id) }, status: { not: "REJECTED" } }, select: { transferId: true, type: true } });
  const dm = new Map<string, string[]>(); for (const d of docs) dm.set(d.transferId!, [...(dm.get(d.transferId!) ?? []), d.type]);
  const items = rows.map(t => {
    const route = (t.route ?? {}) as { legs?: { partner?: string; rails?: string[] }[] };
    const srcDec = dec(t.sourceCurrency), dstDec = dec(t.destCurrency);
    const rate = Number(t.sourceAmount) > 0 ? (Number(t.destAmount) / 10 ** dstDec) / (Number(t.sourceAmount) / 10 ** srcDec) : 0;
    return {
      reference: t.id, created_at: t.createdAt.toISOString(), completed_at: t.completedAt?.toISOString() ?? "", status: t.status, mode: t.isSandbox ? "TEST" : "LIVE",
      sender: t.sender.legalName, sender_country: t.originCountry, recipient: t.recipient.legalName, recipient_country: t.destCountry,
      source_currency: t.sourceCurrency, source_amount: fmtMinor(t.sourceAmount, t.sourceCurrency), dest_currency: t.destCurrency, dest_amount: fmtMinor(t.destAmount, t.destCurrency),
      effective_rate: rate ? rate.toFixed(6) : "", fees_usd: fmtMinor(t.quotedFeesUsd, "USD"), funding_method: t.fundingMethod,
      partners: Array.from(new Set((route.legs ?? []).map(l => l.partner).filter(Boolean))).join(" > "), rails: Array.from(new Set((route.legs ?? []).flatMap(l => l.rails ?? []))).join(","),
      purpose_code: t.purposeCode ?? "", invoice_number: t.invoiceId ? inv.get(t.invoiceId) ?? "" : "", partner_ref: t.externalRef ?? "", efira_ref: t.efiraRef ?? "", documents_on_file: (dm.get(t.id) ?? []).join(","),
    };
  });
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, legalName: true } });
  return { account: org?.legalName ?? org?.name ?? organizationId, from: from.toISOString(), to: to.toISOString(), generated_at: new Date().toISOString(), items };
}
type SettlementData = Awaited<ReturnType<typeof settlementsData>>;
const SET_HEAD = ["reference", "created_at", "completed_at", "status", "mode", "sender", "sender_country", "recipient", "recipient_country", "source_currency", "source_amount", "dest_currency", "dest_amount", "effective_rate", "fees_usd", "funding_method", "partners", "rails", "purpose_code", "invoice_number", "partner_ref", "efira_ref", "documents_on_file"] as const;

export async function renderSettlements(d: SettlementData, format: Format): Promise<{ body: BodyInit; type: string; ext: string }> {
  if (format === "csv") return { body: toCsv([...SET_HEAD], d.items.map(i => SET_HEAD.map(h => i[h]))), type: "text/csv; charset=utf-8", ext: "csv" };
  if (format === "xml") {
    return { type: "application/xml; charset=utf-8", ext: "xml", body: toXml("VaulteSettlements", {
      "@version": "1.0", "@generated": d.generated_at, Account: d.account, Period: { From: d.from, To: d.to }, Note: REPORT_NOTE,
      Settlements: { Settlement: d.items.map(i => ({ "@reference": i.reference, "@status": i.status, "@mode": i.mode, CreatedAt: i.created_at, CompletedAt: i.completed_at, Sender: { Name: i.sender, Country: i.sender_country }, Recipient: { Name: i.recipient, Country: i.recipient_country }, Source: { Currency: i.source_currency, Amount: i.source_amount }, Destination: { Currency: i.dest_currency, Amount: i.dest_amount }, EffectiveRate: i.effective_rate, FeesUsd: i.fees_usd, FundingMethod: i.funding_method, Partners: i.partners, Rails: i.rails, PurposeCode: i.purpose_code, InvoiceNumber: i.invoice_number, PartnerReference: i.partner_ref, EfiraReference: i.efira_ref, DocumentsOnFile: i.documents_on_file })) },
    }) };
  }
  const pdf = await newPdf("Settlement report");
  const w = pdf.w;
  w.h1("Settlement report");
  w.kv([["Account", d.account], ["Period", `${d.from.slice(0, 10)} to ${d.to.slice(0, 10)}`], ["Transfers", String(d.items.length)], ["Generated", d.generated_at.replace("T", " ").slice(0, 19) + " UTC"]]);
  w.table(["Date", "Ref", "Status", "To", "Sent", "Received by recipient", "Rate", "Fees USD"], d.items.map(i => [i.created_at.slice(0, 10), i.reference.slice(-8), i.status, `${i.recipient} (${i.recipient_country})`, `${i.source_currency} ${i.source_amount}`, `${i.dest_currency} ${i.dest_amount}`, i.effective_rate, i.fees_usd]), [52, 48, 66, 110, 70, 80, 40, 31]);
  w.p(REPORT_NOTE, 8);
  return { body: Buffer.from(await pdf.doc.save()), type: "application/pdf", ext: "pdf" };
}

async function newPdf(title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setCreator("Vaulte"); doc.setProducer("Vaulte");
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, w: new Writer(doc, font, bold, clean(`${title} · Vaulte record, not a bank statement or certificate. Vaulte does not hold customer funds.`)) };
}

export const reportHeaders = (type: string, name: string, ext: string) => ({ "Content-Type": type, "Content-Disposition": `attachment; filename="${name}.${ext}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
