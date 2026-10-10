import { NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth-guards";
import { apiSuccess } from "@/lib/utils";
import { verifyChain } from "@/lib/ledger/gl";
import { guardsInstalled } from "@/lib/ledger/guards";

/** Integrity check: recompute every journal hash and report whether the database guards are installed. */
export async function GET(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  return apiSuccess({ chain: await verifyChain(), database_guards_installed: await guardsInstalled() });
}
