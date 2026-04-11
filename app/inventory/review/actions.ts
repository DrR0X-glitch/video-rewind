"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { bulkUpdateInventoryItemsInDatabase } from "@/lib/server/store";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getStringList(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .flatMap((value) => (typeof value === "string" && value.trim() ? [value.trim()] : []));
}

export async function applyReviewAction(formData: FormData) {
  const action = getString(formData, "action");
  const singleReviewId = getString(formData, "singleReviewId");
  const selectedIds = getStringList(formData, "inventoryIds");
  const inventoryIds = singleReviewId ? [singleReviewId] : selectedIds;

  await bulkUpdateInventoryItemsInDatabase({
    action: action === "delete" ? "delete" : "edit",
    reviewed: action === "delete" ? "" : "true",
    apply_reviewed: action === "delete" ? false : true,
    inventory_ids: inventoryIds,
  });

  revalidatePath("/inventory");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory/review");
  revalidatePath("/");
  revalidatePath("/search");

  redirect("/inventory/review");
}
