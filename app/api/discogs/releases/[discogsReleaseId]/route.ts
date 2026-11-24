import { NextResponse } from "next/server";

import { cdRouteErrorResponse, cdRoutesDisabledResponse } from "@/app/api/_cd-route-guard";
import { DiscogsApiError, fetchDiscogsReleaseDraft } from "@/lib/server/catalog/discogs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ discogsReleaseId: string }> },
) {
  const disabled = cdRoutesDisabledResponse();
  if (disabled) return disabled;

  try {
    const { discogsReleaseId } = await context.params;
    if (!/^\d+$/.test(discogsReleaseId) || Number(discogsReleaseId) < 1) {
      throw new DiscogsApiError("invalid_request", "Discogs release id must be a positive integer");
    }
    const release = await fetchDiscogsReleaseDraft(discogsReleaseId);
    const preview = {
      discogsReleaseId: release.discogsReleaseId,
      title: release.title,
      artists: release.artists,
      releaseYear: release.releaseYear,
      country: release.country,
      label: release.label,
      catalogNumber: release.catalogNumber,
      artworkUrl: release.artworkUrl,
      discogsUrl: release.discogsUrl,
      tracks: release.tracks,
    };
    return NextResponse.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return cdRouteErrorResponse(error);
  }
}
