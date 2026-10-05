// Invoice / proforma PDF (pdf-lib). A Vaulte-generated commercial document: it carries the issuer's own tax particulars and never claims a tax status for them.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/lib/db";
import { clean, money, Writer } from "@/lib/documents/pdf";
import { computeLines } from "./calc";
import { invoiceUrls } from "./service";

const date = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

export async function renderInvoicePdf(invoiceId: string): Promise<Uint8Array | null> {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: { lineItems: true, organization: { select: { name: true, legalName: true, country: true, taxId: true, registrationNumber: true } } },
  });
  if (!inv) return null;
  const issuer = inv.issuerEntityId ? await db.entity.findUnique({ where: { id: inv.issuerEntityId }, select: { legalName: true, country: true, taxId: true, registrationNo: true } }) : null;
  const payerEntity = inv.payerEntityId ? await db.entity.findUnique({ where: { id: inv.payerEntityId }, select: { legalName: true, country: true, taxId: true } }) : null;
  const isPf = inv.kind === "PROFORMA";

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${isPf ? "Proforma invoice" : "Invoice"} ${inv.number}`); pdf.setCreator("Vaulte"); pdf.setProducer("Vaulte");
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(pdf, font, bold, `${inv.number} · Created with Vaulte, a software platform. Vaulte does not hold funds; payments are executed by licensed partners.`);

  w.h1(isPf ? "PROFORMA INVOICE" : "INVOICE");
  w.kv([
    ["Number", inv.number], ["Date", date(inv.createdAt)], ["Due date", date(inv.dueDate)], ["Currency", inv.currency],
    ...(inv.reference ? [["Reference / PO", inv.reference] as [string, string]] : []),
    ...(inv.purposeCode ? [["Purpose code", inv.purposeCode] as [string, string]] : []),
    ["Status", inv.status === "PAID" ? "PAID" : isPf ? "PROFORMA (not a tax invoice)" : inv.status],
  ]);

  const fromName = issuer?.legalName ?? inv.organization.legalName ?? inv.organization.name;
  w.h2("From");
  w.kv([
    ["Name", fromName], ["Country", issuer?.country ?? inv.organization.country ?? "-"],
    ["Tax ID", issuer?.taxId ?? inv.organization.taxId ?? "-"], ["Registration no.", issuer?.registrationNo ?? inv.organization.registrationNumber ?? "-"],
  ]);
  w.h2("Bill to");
  w.kv([
    ["Name", inv.recipientName ?? payerEntity?.legalName ?? "-"], ["Address", inv.payerAddress ?? "-"],
    ["Tax ID", inv.payerTaxId ?? payerEntity?.taxId ?? "-"], ["Email", inv.recipientEmail ?? "-"],
  ]);

  const calc = computeLines(inv.lineItems.map(l => ({ description: l.description, quantity: l.quantity, unit_price: Number(l.unitPrice), tax_rate: l.taxRate })));
  w.h2("Items");
  w.table(["Description", "Qty", "Unit price", "Tax %", "Tax", "Total"],
    calc.lines.map(l => [l.description, String(l.quantity), money(BigInt(l.unit_price), inv.currency), `${l.tax_rate}%`, money(BigInt(l.tax), inv.currency), money(BigInt(l.total), inv.currency)]),
    [190, 40, 80, 40, 70, 73]);
  w.kv([["Subtotal", money(BigInt(calc.subtotal), inv.currency)], ...calc.taxByRate.filter(t => t.rate > 0).map(t => [`Tax ${t.rate}% on ${money(BigInt(t.net), inv.currency)}`, money(BigInt(t.tax), inv.currency)] as [string, string]), ["Total", money(BigInt(calc.total), inv.currency)]]);
  w.page.drawText(clean(`Amount due: ${money(BigInt(calc.total), inv.currency)}`), { x: w.M, y: w.y - 14, size: 13, font: bold, color: rgb(0.1, 0.1, 0.15) }); w.y -= 28;

  w.h2("How to pay");
  const { pay_url } = invoiceUrls(inv.publicToken);
  w.p(inv.status === "PAID" ? "This invoice has been paid. Thank you." : `Pay online (stablecoin or bank transfer through our licensed partners): ${pay_url}`);
  if (inv.notes) { w.h2("Notes"); w.p(inv.notes); }
  w.h2("Important");
  w.p(isPf
    ? "This proforma invoice is an estimate of the goods or services described and is not a tax invoice. A numbered tax invoice is issued when the supply is made or the proforma is converted."
    : "Tax particulars (rates, tax IDs, registration numbers) were entered by the issuer, who is responsible for their accuracy and for any tax invoice, export, GST/VAT or customs requirements in their country.", 8, rgb(0.35, 0.35, 0.4));
  return pdf.save();
}
