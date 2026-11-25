import { NextResponse } from "next/server";

import { DiscogsApiError } from "@/lib/server/catalog/discogs";
import { jsonError } from "@/lib/server/http";

export function cdRoutesDisabledResponse() {
  if (process.env.NODE_ENV === "development") return null;
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export function cdRouteErrorResponse(error: unknown) {
  if (!(error instanceof DiscogsApiError)) return jsonError(error);
  const statusByCode: Record<DiscogsApiError["code"], number> = {
    configuration: 503,
    invalid_request: 400,
    not_found: 404,
    unsupported_format: 422,
    unauthorized: 502,
    forbidden: 502,
    rate_limited: 429,
    timeout: 504,
    network: 502,
    upstream: 502,
    invalid_response: 502,
  };
  return NextResponse.json(
    { error: error.message, code: error.code, rateLimit: error.rateLimit },
    { status: statusByCode[error.code] },
  );
}
