// What the customer pays, split into the licensed partner's cost and Vaulte's own fee, and how Vaulte's fee reaches Vaulte.
// PARTNER_SHARE (the supported model): the partner deducts its cost and Vaulte's fee from the customer's funds and remits Vaulte's fee,
// so Vaulte never holds customer money. The ledger books Vaulte's fee as "due from partner" (see lib/ledger/transfers.ts).
import type { CostBreakdown } from "@/lib/stablecoin/types";

export type FeeCollection = "PARTNER_SHARE";
export const feeCollection = (): FeeCollection => "PARTNER_SHARE";

export interface FeeSplit {
  partner_cost_usd: number;
  vaulte_fee_usd: number;
  vaulte_fee_bps: number;
  total_usd: number;
  total_bps: number;
  collection: FeeCollection;
  collection_note: string;
}

export function feeSplit(b: CostBreakdown): FeeSplit {
  return {
    partner_cost_usd: b.partnerCostUsd,
    vaulte_fee_usd: b.markupUsd,
    vaulte_fee_bps: b.markupBps,
    total_usd: b.totalCostUsd,
    total_bps: b.totalCostBps,
    collection: feeCollection(),
    collection_note: "The licensed partner takes its own cost and Vaulte's fee from the payment and passes Vaulte's fee on. Vaulte does not hold your money.",
  };
}
