"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  bulkUpdateMoviesInDatabase,
  deleteMovieFromDatabase,
  updateMovieInDatabase,
} from "@/lib/server/store";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getStringList(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .flatMap((value) => (typeof value === "string" && value.trim() ? [value.trim()] : []));
}

function getCheckboxValue(formData: FormData, key: string) {
  return formData.get(key) === "true";
}

export async function saveTitleEdits(titleId: string, formData: FormData) {
  await updateMovieInDatabase(titleId, {
    title: getString(formData, "title"),
    sort_title: getString(formData, "sortTitle"),
    media_type: getString(formData, "mediaType"),
    release_year: getString(formData, "releaseYear"),
    genres: getString(formData, "genres"),
    director: getString(formData, "director"),
    cast: getString(formData, "cast"),
    overview: getString(formData, "overview"),
    featured: getCheckboxValue(formData, "featured"),
    hide_from_homepage: getCheckboxValue(formData, "hideFromHomepage"),
  });

  revalidatePath("/");
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${titleId}`);
  revalidatePath(`/movies/${titleId}`);
  redirect(`/inventory/${titleId}`);
}

export async function deleteTitle(titleId: string) {
  await deleteMovieFromDatabase(titleId);

  revalidatePath("/");
  revalidatePath("/inventory");
  redirect("/inventory");
}

export async function applyBulkTitleAction(formData: FormData) {
  await bulkUpdateMoviesInDatabase({
    action: getString(formData, "action"),
    title_ids: getStringList(formData, "titleIds"),
  });

  revalidatePath("/");
  revalidatePath("/inventory");
  redirect("/inventory");
}
