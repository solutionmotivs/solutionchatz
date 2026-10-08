// GET /api/public/scoreboard — measured settlement times per corridor, published only where enough transfers completed (MIN_SAMPLES).
// Counted from the moment the partner confirmed the sender's funds to the moment the recipient was paid. Simulated test-mode transfers are never counted.
import { apiSuccess } from "@/lib/utils";
import { MIN_SAMPLES, settlementReport } from "@/lib/routing/settlement-metrics";

export const revalidate = 300;

export async function GET() {
  const rows = (await settlementReport().catch(() => [])).filter(r => !r.sandbox && r.samples >= MIN_SAMPLES);
  return apiSuccess({
    min_samples: MIN_SAMPLES,
    window_days: 30,
    corridors: rows.map(r => ({ from: r.origin, to: r.dest, mode: r.sandbox ? "test" : "live", samples: r.samples, p50_seconds: r.p50_seconds, p90_seconds: r.p90_seconds, same_day_pct: r.same_day_pct })),
    note: "Measured on completed transfers, not promised. A corridor appears only after enough transfers.",
  });
}
