// POST /api/partner-customers/{id}/requests/{requestId} {values, files:{key:{name,mime,data_base64}}}: answers one of the partner's questions.
// Documents are forwarded to the partner in this call and are not stored by Vaulte.
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/utils";
import { readJson } from "@/lib/api-helpers";
import { invoiceAuth } from "@/lib/invoices/auth";
import { InfoRequestError, answerInfoRequest } from "@/lib/partners/info-requests";

export const maxDuration = 60;
const Body = z.object({
  values: z.record(z.string().max(2000)).default({}),
  files: z.record(z.object({ name: z.string().max(200), mime: z.string().max(80), data_base64: z.string().max(10_000_000) })).default({}),
});

export async function POST(req: NextRequest, { params }: { params: { id: string; requestId: string } }) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  if (a.via !== "session") return apiError("FORBIDDEN", "Partner questions can be answered by a signed-in person only", 403);
  const p = Body.safeParse(await readJson(req));
  if (!p.success) return apiError("VALIDATION_ERROR", "Send {values, files}", 400);
  try {
    await answerInfoRequest(a.organizationId, a.userId, params.id, params.requestId, { values: p.data.values, files: Object.fromEntries(Object.entries(p.data.files).map(([k, f]) => [k, { name: f.name, mime: f.mime, dataBase64: f.data_base64 }])) });
    return apiSuccess({ ok: true });
  } catch (e) { if (e instanceof InfoRequestError) return apiError(e.code, e.message, e.status); throw e; }
}
