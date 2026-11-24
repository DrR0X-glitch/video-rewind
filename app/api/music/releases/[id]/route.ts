import { cdRoutesDisabledResponse } from "@/app/api/_cd-route-guard";
import {
  getMusicReleaseForStaff,
  updateMusicReleaseSortTitle,
} from "@/lib/server/catalog/music-releases";
import { createHttpError, ensureObject, jsonError } from "@/lib/server/http";

function assertReleaseId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw createHttpError(400, "Music release id is invalid");
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const disabled = cdRoutesDisabledResponse();
  if (disabled) return disabled;

  try {
    const { id } = await context.params;
    assertReleaseId(id);
    const release = await getMusicReleaseForStaff(id);
    return Response.json(release, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const disabled = cdRoutesDisabledResponse();
  if (disabled) return disabled;

  try {
    const { id } = await context.params;
    assertReleaseId(id);
    const body = ensureObject(await request.json());
    const release = await updateMusicReleaseSortTitle(id, body.sortTitle);
    return Response.json(release, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
