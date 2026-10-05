import { apiError } from "@/lib/utils";
import { ServiceError } from "@/lib/stablecoin/service";

/** Maps service-layer errors to the API error envelope (with guardrail details when present). */
export function handleServiceError(e: unknown): Response {
  if (e instanceof ServiceError) {
    const body = {
      error: {
        code: e.code,
        message: e.message,
        ...(e.details ? { details: e.details } : {}),
        doc_url: `https://docs.vaulte.io/errors/${e.code.toLowerCase()}`,
      },
    };
    return Response.json(body, { status: e.status });
  }
  console.error("Unhandled error:", e);
  return apiError("INTERNAL_ERROR", "Something went wrong", 500);
}

export async function readJson(req: Request): Promise<unknown | undefined> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}
