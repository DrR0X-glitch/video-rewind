import { NextResponse } from "next/server";

import { cdRouteErrorResponse, cdRoutesDisabledResponse } from "@/app/api/_cd-route-guard";
import { fetchDiscogsReleaseDraft } from "@/lib/server/catalog/discogs";
import {
  createManualMusicRelease,
  getMusicReleaseForStaff,
  getStoredMusicReleaseByDiscogsId,
  linkCdInventoryItemToMusicRelease,
  storeDiscogsMusicRelease,
} from "@/lib/server/catalog/music-releases";
import { createHttpError, ensureObject, requireString } from "@/lib/server/http";

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "statusCode" in error && error.statusCode === 404,
  );
}

export async function POST(request: Request) {
  const disabled = cdRoutesDisabledResponse();
  if (disabled) return disabled;

  try {
    const body = ensureObject(await request.json());
    if (body.source === "manual") {
      const created = await createManualMusicRelease({
        title: body.title,
        sortTitle: body.sortTitle,
        artistCredit: body.artistCredit,
        releaseYear: body.releaseYear,
        tracks: body.tracks,
      });
      const release = await getMusicReleaseForStaff(created.id);
      return NextResponse.json(release, {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (body.source !== undefined && body.source !== "discogs") {
      throw createHttpError(400, 'Field "source" must be "discogs" or "manual"');
    }
    const discogsReleaseId = body.discogsReleaseId;
    const normalizedReleaseId =
      typeof discogsReleaseId === "number" && Number.isSafeInteger(discogsReleaseId)
        ? discogsReleaseId
        : typeof discogsReleaseId === "string" && /^\d+$/.test(discogsReleaseId)
          ? Number(discogsReleaseId)
          : NaN;
    if (!Number.isSafeInteger(normalizedReleaseId) || normalizedReleaseId < 1) {
      throw createHttpError(400, 'Field "discogsReleaseId" must be a positive integer');
    }

    let existingRelease: Awaited<ReturnType<typeof getStoredMusicReleaseByDiscogsId>> | null = null;
    try {
      existingRelease = await getStoredMusicReleaseByDiscogsId(normalizedReleaseId);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    if (existingRelease) {
      if (body.inventoryItemId !== undefined) {
        const inventoryItemId = requireString(body.inventoryItemId, "inventoryItemId");
        await linkCdInventoryItemToMusicRelease(inventoryItemId, existingRelease.id);
      }
      return NextResponse.json(existingRelease, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const draft = await fetchDiscogsReleaseDraft(normalizedReleaseId);
    const saved = await storeDiscogsMusicRelease(draft, body.sortTitle);
    if (body.inventoryItemId !== undefined) {
      const inventoryItemId = requireString(body.inventoryItemId, "inventoryItemId");
      await linkCdInventoryItemToMusicRelease(inventoryItemId, saved.id);
    }
    const release = await getMusicReleaseForStaff(saved.id);
    return NextResponse.json(release, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return cdRouteErrorResponse(error);
  }
}
