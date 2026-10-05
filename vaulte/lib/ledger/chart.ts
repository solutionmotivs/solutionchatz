// Chart of accounts. Account codes are stable identifiers used by ERP exports.
// Classification: type (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE) drives the statements; class refines presentation.
// Memo accounts (9xxx) track customer money held by licensed partners: Vaulte does NOT own it, so it never appears
// on Vaulte's balance sheet.
export interface AccountDef {
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  class: string;
  isMemo?: boolean;
  description?: string;
}

export const CHART: AccountDef[] = [
  { code: "1000", name: "Bank - operating accounts", type: "ASSET", class: "CURRENT_ASSET", description: "Vaulte's own bank balances (not customer money)" },
  { code: "1100", name: "Due from partners - fees", type: "ASSET", class: "CURRENT_ASSET", description: "Markup earned and held by partners until remitted to Vaulte" },
  { code: "1200", name: "Other receivables", type: "ASSET", class: "CURRENT_ASSET" },
  { code: "1300", name: "Prepaid expenses", type: "ASSET", class: "CURRENT_ASSET" },
  { code: "2000", name: "Partner costs payable", type: "LIABILITY", class: "CURRENT_LIABILITY", description: "Partner fees and spread owed (gross-basis accounting only)" },
  { code: "2100", name: "Taxes payable (GST/VAT)", type: "LIABILITY", class: "CURRENT_LIABILITY" },
  { code: "2200", name: "Accounts payable", type: "LIABILITY", class: "CURRENT_LIABILITY" },
  { code: "3000", name: "Share capital", type: "EQUITY", class: "EQUITY" },
  { code: "3100", name: "Retained earnings", type: "EQUITY", class: "EQUITY" },
  { code: "4000", name: "Revenue - transfer markup", type: "REVENUE", class: "OPERATING_REVENUE", description: "Vaulte's markup on FX and transfer fees" },
  { code: "4100", name: "Revenue - gross fees charged", type: "REVENUE", class: "OPERATING_REVENUE", description: "Used only under gross (principal) accounting" },
  { code: "4900", name: "Other income", type: "REVENUE", class: "OTHER_INCOME" },
  { code: "5000", name: "Partner costs", type: "EXPENSE", class: "COST_OF_REVENUE", description: "Partner fees and spread (gross-basis accounting only)" },
  { code: "5100", name: "FX gains and losses", type: "EXPENSE", class: "OTHER_EXPENSE", description: "Realised/unrealised FX on Vaulte's own balances (debit = loss)" },
  { code: "5200", name: "Bank and payment charges", type: "EXPENSE", class: "OPERATING_EXPENSE" },
  { code: "6000", name: "Operating expenses", type: "EXPENSE", class: "OPERATING_EXPENSE" },
  { code: "9100", name: "MEMO Funds held by partners for customers", type: "ASSET", class: "MEMO_CUSTODY", isMemo: true, description: "Customer money sitting with licensed partners. Not Vaulte's asset." },
  { code: "9200", name: "MEMO Customer transfer obligations", type: "LIABILITY", class: "MEMO_CUSTODY", isMemo: true, description: "What partners owe customers/recipients for open transfers. Not Vaulte's liability." },
];

export const ACCOUNT = {
  BANK: "1000", DUE_FROM_PARTNERS: "1100", PARTNER_PAYABLE: "2000", REV_MARKUP: "4000", REV_GROSS: "4100", PARTNER_COSTS: "5000", FX_GAIN_LOSS: "5100",
  MEMO_HELD: "9100", MEMO_OBLIGATIONS: "9200",
} as const;

export const NORMAL_BALANCE = (type: AccountDef["type"]) => (type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT");
