// POST /api/admin/sanctions/search — staff run an ad-hoc name or wallet check.
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth-guards";
import { apiSuccess } from "@/lib/utils";
import { parseJson } from "@/lib/kyc/api";
import { screenName, screenWalletAddress } from "@/lib/sanctions/screen";

const Body = z.object({
  name: z.string().min(2).max(200).optional(), address: z.string().min(10).max(120).optional(),
  country: z.string().length(2).optional(), kind: z.enum(["INDIVIDUAL", "ENTITY"]).optional(), date_of_birth: z.string().max(10).optional(),
}).refine(b => !!b.name !== !!b.address, "Provide either a name or a wallet address");

export async function POST(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const p = await parseJson(req, Body);
  if (p.response) return p.response;
  if (p.data.address) return apiSuccess(await screenWalletAddress(p.data.address, { subjectType: "WALLET" }));
  return apiSuccess(await screenName({ name: p.data.name!, country: p.data.country, kind: p.data.kind, dateOfBirth: p.data.date_of_birth }, { subjectType: "ENTITY" }));
}
