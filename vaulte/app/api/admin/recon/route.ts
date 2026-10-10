// POST: import a partner statement (JSON lines or CSV text) and auto-match; GET: exceptions queue.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { parseJson } from "@/lib/kyc/api";
import { parseCsv } from "@/lib/sanctions/parsers";
import { LedgerError } from "@/lib/ledger/gl";
import { importStatement, missingFromStatements, type ReconInput } from "@/lib/ledger/recon";

const Line = z.object({ direction: z.enum(["FUNDING", "PAYOUT", "FEE", "OTHER"]), reference: z.string().min(1).max(120), currency: z.string().length(3), amount: z.string().regex(/^-?\d+(\.\d+)?$/), date: z.string().optional(), description: z.string().max(300).optional() });
const Body = z.object({ partner: z.string().min(2).max(60), label: z.string().max(100).optional(), lines: z.array(Line).max(5000).optional(), csv: z.string().max(2_000_000).optional() }).refine(b => !!b.lines !== !!b.csv, "Send either lines or csv");

export async function POST(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const p = await parseJson(req, Body);
  if (p.response) return p.response;
  let lines: ReconInput[];
  if (p.data.csv) {
    const rows = parseCsv(p.data.csv).filter(r => r.some(c => c.trim()));
    const head = rows[0]?.map(h => h.trim().toLowerCase()) ?? [];
    for (const need of ["direction", "reference", "currency", "amount"]) if (!head.includes(need)) return apiError("VALIDATION_ERROR", `CSV needs a "${need}" column (columns: direction,reference,currency,amount[,date,description])`, 400);
    lines = rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])) as unknown as ReconInput);
    const bad = lines.findIndex(l => !Line.safeParse(l).success);
    if (bad >= 0) return apiError("VALIDATION_ERROR", `CSV row ${bad + 2} is not valid`, 400);
  } else lines = p.data.lines!;
  try {
    return apiSuccess(await importStatement({ partner: p.data.partner, label: p.data.label, uploadedBy: staff.user.id, lines }), 201);
  } catch (e) {
    if (e instanceof LedgerError) return apiError("RECON_REJECTED", e.message, 422);
    throw e;
  }
}

export async function GET(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const q = req.nextUrl.searchParams;
  const status = q.get("status") ?? "exceptions";
  const where = status === "exceptions" ? { status: { in: ["UNMATCHED", "AMOUNT_MISMATCH"] } } : { status };
  const lines = await db.reconLine.findMany({ where, orderBy: { id: "desc" }, take: 200, include: { batch: { select: { partner: true, label: true } } } });
  const missing = q.get("partner") ? await missingFromStatements(q.get("partner")!, new Date(q.get("from") ?? Date.now() - 31 * 86400000), new Date(q.get("to") ?? Date.now())) : undefined;
  return apiSuccess({
    data: lines.map(l => ({ id: l.id, partner: l.batch.partner, batch: l.batch.label, direction: l.direction, reference: l.reference, currency: l.currency, amount_minor: l.amountMinor.toString(), expected_minor: l.expectedMinor?.toString() ?? null, status: l.status, transfer_id: l.transferId, note: l.note })),
    missing_from_statements: missing,
  });
}
