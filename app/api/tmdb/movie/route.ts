import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { jsonError } from "@/lib/server/http";
import { fetchTmdbTitleDraft } from "@/lib/server/tmdb";

export async function GET(request: NextRequest) {
  try {
    const input =
      request.nextUrl.searchParams.get("url") ?? request.nextUrl.searchParams.get("id") ?? "";

    const movie = await fetchTmdbTitleDraft(input);
    return NextResponse.json(movie);
  } catch (error) {
    return jsonError(error);
  }
}
