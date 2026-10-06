// GET /api/admin/jobs — staff: every scheduled job, how often it should run, and when it last ran and what it returned.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiSuccess } from "@/lib/utils";
import { JOBS } from "@/lib/scheduler";

export async function GET(req: NextRequest) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  const rows = await db.jobLease.findMany();
  return apiSuccess({ scheduler_enabled: process.env.ENABLE_INTERNAL_SCHEDULER === "true", jobs: JOBS.map(j => { const r = rows.find(x => x.name === j.name); return { name: j.name, every_minutes: Math.round(j.everyMs / 60_000), last_run_at: r?.lastRunAt?.toISOString() ?? null, last_ok: r?.lastOk ?? null, last_ms: r?.lastMs ?? null, last_result: r?.lastResult ?? null }; }) });
}
