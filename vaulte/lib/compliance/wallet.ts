// Wallet-address screening: exact match against crypto addresses published on the OFAC SDN list (and optionally Chainalysis).
// This is list screening, not blockchain-analytics risk scoring: exposure to mixers or indirect links needs a provider
// such as Chainalysis KYT, TRM or Elliptic, which partners usually run on their side.
import { screenWalletAddress, type Ctx } from "@/lib/sanctions/screen";

export async function screenWallet(address: string, ctx: Partial<Ctx> = {}): Promise<{ cleared: boolean; reason?: string }> {
  const r = await screenWalletAddress(address, { subjectType: "WALLET", ...ctx });
  if (r.outcome === "BLOCK") return { cleared: false, reason: "Address matches a sanctions listing" };
  return { cleared: true };
}
