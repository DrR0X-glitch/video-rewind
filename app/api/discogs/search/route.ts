import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { cdRouteErrorResponse, cdRoutesDisabledResponse } from "@/app/api/_cd-route-guard";
import { searchDiscogsReleaseCandidates } from "@/lib/server/catalog/discogs";
import { createHttpError } from "@/lib/server/http";

function parsePositiveQueryNumber(value: string | null, field: string, fallback: number) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value))
    throw createHttpError(400, `Query parameter "${field}" must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw createHttpError(400, `Query parameter "${field}" must be a positive integer`);
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  const disabled = cdRoutesDisabledResponse();
  if (disabled) return disabled;

  try {
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (!query) throw createHttpError(400, 'Query parameter "q" is required');
    const page = parsePositiveQueryNumber(request.nextUrl.searchParams.get("page"), "page", 1);
    const perPage = parsePositiveQueryNumber(
      request.nextUrl.searchParams.get("perPage"),
      "perPage",
      20,
    );
    if (perPage > 100) throw createHttpError(400, 'Query parameter "perPage" must be at most 100');

    const results = await searchDiscogsReleaseCandidates({ query, page, perPage });
    return NextResponse.json(results, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return cdRouteErrorResponse(error);
  }
}
