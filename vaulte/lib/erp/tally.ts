// Tally Prime/ERP 9 voucher import XML. Tally has no webhooks or REST: it takes XML over HTTP (default port 9000) from a
// machine that can reach it, so Vaulte exports the XML and a small bridge (scripts/tally-bridge.mjs) posts it locally.
import { DEFAULT_MAPPING, money, type ErpMapping, type Voucher } from "./vouchers";

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] as string)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const ymd = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;

export function tallyXml(vouchers: Voucher[], mapping: ErpMapping = {}): string {
  const m = { ...DEFAULT_MAPPING, ...mapping };
  const parties = new Map<string, "Sundry Debtors" | "Sundry Creditors">();
  for (const v of vouchers) parties.set(v.party, v.type === "RECEIPT" ? "Sundry Debtors" : "Sundry Creditors");
  const masters = mapping.create_masters === false ? "" : [
    ...Array.from(parties).map(([name, parent]) => `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><PARENT>${parent}</PARENT></LEDGER></TALLYMESSAGE>`),
    `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(m.charges)}" ACTION="Create"><NAME>${esc(m.charges)}</NAME><PARENT>Indirect Expenses</PARENT></LEDGER></TALLYMESSAGE>`,
  ].join("");
  const body = vouchers.map(v => {
    const type = v.type === "PAYMENT" ? "Payment" : "Receipt";
    const name = (role: string) => (role === "BANK" ? m.bank : role === "CHARGES" ? m.charges : v.party);
    const entries = v.lines.map(l => {
      // Tally sign convention: debit = ISDEEMEDPOSITIVE Yes with a negative amount; credit = No with a positive amount.
      const debit = l.side === "DEBIT";
      return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(name(l.role))}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${debit ? "-" : ""}${money(l.amountMinor, v.currency)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
    }).join("");
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${ymd(v.date)}</DATE><EFFECTIVEDATE>${ymd(v.date)}</EFFECTIVEDATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(v.id.slice(-24))}</VOUCHERNUMBER><REFERENCE>${esc(v.reference.slice(0, 60))}</REFERENCE><PARTYLEDGERNAME>${esc(v.party)}</PARTYLEDGERNAME><NARRATION>${esc(v.narration.slice(0, 240))}</NARRATION>${entries}</VOUCHER></TALLYMESSAGE>`;
  }).join("");
  const company = mapping.company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${esc(mapping.company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${company}</REQUESTDESC><REQUESTDATA>${masters}${body}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}
