// Trade-based risk flags from HS codes. A SMALL, deliberately conservative table that mirrors Vaulte's Acceptable Use policy and common
// AML typologies; it is not an export-control classification (dual-use control lists are defined by technical specification, not by
// HS heading). PROHIBITED blocks the transfer; REVIEW holds it for a staff check before the payout.
import { normalizeHs } from "./hs";

export type TradeSeverity = "PROHIBITED" | "REVIEW";
export interface TradeFlag { code: string; severity: TradeSeverity; hs: string; reason: string }

interface Rule { code: string; severity: TradeSeverity; match: (hs: string) => boolean; reason: string }
const chapter = (...c: string[]) => (hs: string) => c.includes(hs.slice(0, 2));
const heading = (...h: string[]) => (hs: string) => h.includes(hs.slice(0, 4));

export const TRADE_RULES: Rule[] = [
  { code: "ARMS", severity: "PROHIBITED", match: chapter("93"), reason: "Arms and ammunition (HS chapter 93) are prohibited by the Acceptable Use policy" },
  { code: "RADIOACTIVE_NUCLEAR", severity: "PROHIBITED", match: heading("2844", "2845", "8401"), reason: "Radioactive/nuclear materials and reactors are prohibited" },
  { code: "EXPLOSIVES", severity: "PROHIBITED", match: chapter("36"), reason: "Explosives, pyrotechnics and propellants (HS chapter 36) are prohibited" },
  { code: "NARCOTIC_PLANTS", severity: "REVIEW", match: heading("1211", "1207", "1302"), reason: "Plants and extracts that can fall under narcotics law need a licence check" },
  { code: "PRECIOUS_METALS_STONES", severity: "REVIEW", match: chapter("71"), reason: "Precious metals, stones and jewellery (HS chapter 71) are a known money-laundering channel: enhanced review" },
  { code: "CHEMICAL_PRECURSOR_RISK", severity: "REVIEW", match: heading("2931", "2932", "2933", "2934", "3808"), reason: "Organic chemicals and pesticides: possible precursor or dual-use chemicals" },
  { code: "ALCOHOL_TOBACCO", severity: "REVIEW", match: chapter("22", "24"), reason: "Alcohol and tobacco need import/export licences in many markets" },
  { code: "AIRCRAFT_SPACE", severity: "REVIEW", match: chapter("88"), reason: "Aircraft and spacecraft parts can be export-controlled" },
  { code: "ELECTRONICS_MACHINERY_DUAL_USE", severity: "REVIEW", match: heading("8471", "8517", "8525", "8526", "8543", "9013", "9014", "9015"), reason: "Computing, telecoms, radar/navigation and optics can be dual-use; check destination and end user" },
];

export function tradeFlags(hsCodes: string[]): TradeFlag[] {
  const out: TradeFlag[] = [];
  for (const raw of new Set(hsCodes)) {
    const hs = normalizeHs(raw);
    for (const r of TRADE_RULES) if (r.match(hs)) out.push({ code: r.code, severity: r.severity, hs, reason: r.reason });
  }
  return out;
}
