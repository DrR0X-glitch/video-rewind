"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CustomTitleInputError } from "@/lib/catalog/custom-title-input";
import { createCustomTitle } from "@/lib/server/catalog/custom-titles";
import { fetchTmdbTitleDraft } from "@/lib/server/tmdb";
import {
  createInventoryItemInDatabase,
  createMovieInDatabase,
  findDuplicateMovieForDraft,
  generateInventoryCodeForDisc,
} from "@/lib/server/store";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getStringList(formData: FormData, key: string) {
  return formData.getAll(key).flatMap((value) => (typeof value === "string" ? [value.trim()] : []));
}

export async function addDiscToExistingTitle(formData: FormData) {
  const titleIds = getString(formData, "titleIds");
  const generateBarcode = formData.get("generateBarcode") === "true";
  const linkedTitleIds = getStringList(formData, "linkedTitleId");
  const seasonStarts = getStringList(formData, "seasonStart");
  const seasonEnds = getStringList(formData, "seasonEnd");
  const episodeStarts = getStringList(formData, "episodeStart");
  const episodeEnds = getStringList(formData, "episodeEnd");

  const result = await createInventoryItemInDatabase({
    title_ids: titleIds,
    title_links: linkedTitleIds.map((titleId, index) => ({
      title_id: titleId,
      season_start: seasonStarts[index] || null,
      season_end: seasonEnds[index] || null,
      episode_start: episodeStarts[index] || null,
      episode_end: episodeEnds[index] || null,
    })),
    availability: formData.get("availability") === "true",
    format: getString(formData, "format"),
    sealed: formData.get("sealed") === "true",
    zone: getString(formData, "zone"),
    section: getString(formData, "section"),
    row: getString(formData, "row"),
    day_price: getString(formData, "dayPrice"),
    weekend_price: getString(formData, "weekendPrice"),
    late_class: getString(formData, "lateClass"),
    notes: getString(formData, "notes"),
  });

  revalidatePath("/inventory");
  revalidatePath("/inventory/new");
  revalidatePath(`/inventory/discs/${result.id}`);
  const primaryTitleId = titleIds.split(",")[0];
  revalidatePath(`/inventory/${primaryTitleId}`);

  if (generateBarcode) {
    await generateInventoryCodeForDisc(result.id);
    revalidatePath(`/inventory/discs/${result.id}`);
    redirect(`/inventory/discs/${result.id}/label?print=true`);
  }

  redirect("/inventory/new");
}

export async function createTitleAndAddToDisc(formData: FormData) {
  const tmdbInput = getString(formData, "tmdb");
  const tmdbDraft = await fetchTmdbTitleDraft(tmdbInput);
  const duplicateId = await findDuplicateMovieForDraft({
    tmdbId: tmdbDraft.tmdbId,
    mediaType: tmdbDraft.mediaType,
    title: tmdbDraft.title,
    releaseDate: tmdbDraft.releaseDate,
  });

  if (duplicateId) {
    const existingTitleIds = getString(formData, "titleIds");
    const mergedDuplicateIds = Array.from(
      new Set([
        duplicateId,
        ...existingTitleIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ]),
    ).join(",");
    redirect(`/inventory/new?selected=${encodeURIComponent(mergedDuplicateIds)}`);
  }

  const titleId = await createMovieInDatabase({
    tmdbId: tmdbDraft.tmdbId,
    imdbId: tmdbDraft.imdbId,
    mediaType: tmdbDraft.mediaType,
    title: getString(formData, "title") || tmdbDraft.title,
    sortTitle: getString(formData, "sortTitle") || tmdbDraft.sortTitle,
    overview: tmdbDraft.overview,
    releaseDate: tmdbDraft.releaseDate,
    posterPath: tmdbDraft.posterPath,
    genres: tmdbDraft.genres,
    director: tmdbDraft.director,
    cast: tmdbDraft.cast,
    collection: tmdbDraft.collection,
  });

  const existingTitleIds = getString(formData, "titleIds");
  const mergedTitleIds = Array.from(
    new Set([
      titleId,
      ...existingTitleIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ]),
  ).join(",");

  revalidatePath("/");
  revalidatePath("/inventory");
  redirect(`/inventory/new?selected=${encodeURIComponent(mergedTitleIds)}`);
}

export async function createTitleOnly(formData: FormData) {
  const tmdbInput = getString(formData, "tmdb");
  const tmdbDraft = await fetchTmdbTitleDraft(tmdbInput);
  const duplicateId = await findDuplicateMovieForDraft({
    tmdbId: tmdbDraft.tmdbId,
    mediaType: tmdbDraft.mediaType,
    title: tmdbDraft.title,
    releaseDate: tmdbDraft.releaseDate,
  });

  if (duplicateId) {
    revalidatePath("/");
    revalidatePath("/inventory");
    redirect("/inventory/new");
  }

  await createMovieInDatabase({
    tmdbId: tmdbDraft.tmdbId,
    imdbId: tmdbDraft.imdbId,
    mediaType: tmdbDraft.mediaType,
    title: getString(formData, "title") || tmdbDraft.title,
    sortTitle: getString(formData, "sortTitle") || tmdbDraft.sortTitle,
    overview: tmdbDraft.overview,
    releaseDate: tmdbDraft.releaseDate,
    posterPath: tmdbDraft.posterPath,
    genres: tmdbDraft.genres,
    director: tmdbDraft.director,
    cast: tmdbDraft.cast,
    collection: tmdbDraft.collection,
  });

  revalidatePath("/");
  revalidatePath("/inventory");
  revalidatePath("/inventory/new");
  redirect("/inventory/new");
}

export async function createCustomTitleForNewDisc(formData: FormData) {
  let result;
  try {
    result = await createCustomTitle({
      title: getString(formData, "customTitle"),
      sortTitle: getString(formData, "customSortTitle"),
      mediaType: getString(formData, "customMediaType"),
      releaseDate: getString(formData, "customReleaseDate"),
      overview: getString(formData, "customOverview"),
      genres: getString(formData, "customGenres"),
      director: getString(formData, "customDirector"),
    });
  } catch (error) {
    if (error instanceof CustomTitleInputError) {
      redirect(`/inventory/new?customError=${encodeURIComponent(error.field)}`);
    }
    throw error;
  }

  const existingTitleIds = getString(formData, "titleIds")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const selectedIds = Array.from(new Set([result.titleId, ...existingTitleIds]));

  revalidatePath("/inventory");
  revalidatePath("/inventory/new");
  redirect(
    `/inventory/new?selected=${encodeURIComponent(selectedIds.join(","))}${result.duplicate ? "&customDuplicate=1" : ""}`,
  );
}
