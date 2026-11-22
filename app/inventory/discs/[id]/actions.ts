"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  clearInventoryCodeForDisc,
  generateInventoryCodeForDisc,
  updateInventoryItemInDatabase,
} from "@/lib/server/store";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getStringList(formData: FormData, key: string) {
  return formData.getAll(key).flatMap((value) => (typeof value === "string" ? [value.trim()] : []));
}

export async function updateDisc(formData: FormData) {
  const discId = getString(formData, "discId");
  const returnTitleId = getString(formData, "returnTitleId");
  const returnTo = getString(formData, "returnTo");
  const linkedTitleIds = getStringList(formData, "linkedTitleId");
  const seasonStarts = getStringList(formData, "seasonStart");
  const seasonEnds = getStringList(formData, "seasonEnd");
  const episodeStarts = getStringList(formData, "episodeStart");
  const episodeEnds = getStringList(formData, "episodeEnd");

  await updateInventoryItemInDatabase(discId, {
    availability: formData.get("availability") === "true",
    reviewed: formData.get("reviewed") === "true",
    title_links: linkedTitleIds.map((titleId, index) => ({
      title_id: titleId,
      season_start: seasonStarts[index] || null,
      season_end: seasonEnds[index] || null,
      episode_start: episodeStarts[index] || null,
      episode_end: episodeEnds[index] || null,
    })),
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
  revalidatePath("/inventory/review");
  revalidatePath("/inventory/stock");
  revalidatePath("/");
  revalidatePath("/search");
  revalidatePath(`/inventory/discs/${discId}`);

  if (returnTo) {
    redirect(returnTo);
  }

  if (returnTitleId) {
    revalidatePath(`/inventory/${returnTitleId}`);
    revalidatePath(`/movies/${returnTitleId}`);
    redirect(`/inventory/${returnTitleId}`);
  }

  redirect("/inventory");
}

export async function generateDiscBarcode(formData: FormData) {
  const discId = getString(formData, "discId");
  const returnTitleId = getString(formData, "returnTitleId");
  const printAfter = getString(formData, "printAfter") === "true";

  await generateInventoryCodeForDisc(discId);

  revalidatePath("/inventory");
  revalidatePath(`/inventory/discs/${discId}`);

  if (returnTitleId) {
    revalidatePath(`/inventory/${returnTitleId}`);
  }

  if (printAfter) {
    redirect(`/inventory/discs/${discId}/label?print=true`);
  }

  redirect(`/inventory/discs/${discId}`);
}

export async function clearDiscBarcode(formData: FormData) {
  const discId = getString(formData, "discId");
  const returnTitleId = getString(formData, "returnTitleId");

  await clearInventoryCodeForDisc(discId);

  revalidatePath("/inventory");
  revalidatePath(`/inventory/discs/${discId}`);
  revalidatePath(`/inventory/discs/${discId}/label`);

  if (returnTitleId) {
    revalidatePath(`/inventory/${returnTitleId}`);
  }

  redirect(`/inventory/discs/${discId}`);
}
