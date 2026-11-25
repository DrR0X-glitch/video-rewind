import { cdRouteErrorResponse, cdRoutesDisabledResponse } from "@/app/api/_cd-route-guard";
import { getStoredMusicReleaseByDiscogsId } from "@/lib/server/catalog/music-releases";

export async function GET(
  _request: Request,
  context: { params: Promise<{ discogsReleaseId: string }> },
) {
  const disabled = cdRoutesDisabledResponse();
  if (disabled) return disabled;

  try {
    const { discogsReleaseId } = await context.params;
    const release = await getStoredMusicReleaseByDiscogsId(discogsReleaseId);
    return Response.json(release, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return cdRouteErrorResponse(error);
  }
}
