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

export async function applyBulkStockAction(formData: FormData) {
  const q = getString(formData, "q");
  const section = getString(formData, "section");
  const row = getString(formData, "row");
  const availabilityFilter = getString(formData, "availabilityFilter") || "all";
  const edited = getString(formData, "edited") || "all";
  const formats = getStringList(formData, "format");
  const primary = getString(formData, "primary") || "all";
  const zones = getStringList(formData, "zone");
  const sealedStates = getStringList(formData, "sealed");
  const showAll = getString(formData, "showAll") === "true";
  const sort = getString(formData, "sort") || "updated";
  const dir = getString(formData, "dir") || "desc";
  const page = getString(formData, "page") || "1";

  await bulkUpdateInventoryItemsInDatabase({
    action: getString(formData, "action"),
    availability: getString(formData, "availability"),
    apply_availability: formData.get("applyAvailability") === "true",
    reviewed: getString(formData, "reviewed"),
    apply_reviewed: formData.get("applyReviewed") === "true",
    apply_zone: formData.get("applyZone") === "true",
    zone: getString(formData, "zoneValue"),
    apply_section: formData.get("applySection") === "true",
    section: getString(formData, "sectionValue"),
    apply_row: formData.get("applyRow") === "true",
    row: getString(formData, "rowValue"),
    inventory_ids: getStringList(formData, "inventoryIds"),
  });

  revalidatePath("/inventory");
  revalidatePath("/inventory/stock");
  revalidatePath("/");
  revalidatePath("/search");

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (section) params.set("section", section);
  if (row) params.set("row", row);
  if (availabilityFilter !== "all") params.set("availability", availabilityFilter);
  if (edited !== "all") params.set("edited", edited);
  if (primary !== "all") params.set("primary", primary);
  for (const format of formats) params.append("format", format);
  for (const zone of zones) params.append("zone", zone);
  for (const sealed of sealedStates) params.append("sealed", sealed);
  if (showAll) params.set("showAll", "true");
  params.set("sort", sort);
  params.set("dir", dir);
  if (page !== "1") params.set("page", page);

  redirect(`/inventory/stock?${params.toString()}`);
}
