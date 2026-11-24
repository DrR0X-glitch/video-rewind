import { cdRoutesDisabledResponse } from "@/app/api/_cd-route-guard";
import { searchMusicTracks } from "@/lib/server/catalog/music-releases";
import { createHttpError, jsonError } from "@/lib/server/http";

export async function GET(request: Request) {
  const disabled = cdRoutesDisabledResponse();
  if (disabled) return disabled;

  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q");
    const rawLimit = url.searchParams.get("limit");
    if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
      throw createHttpError(400, 'Query parameter "limit" must be an integer');
    }
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw createHttpError(400, 'Query parameter "limit" must be between 1 and 100');
    }
    return Response.json(await searchMusicTracks(query, limit), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
