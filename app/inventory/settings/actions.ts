"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createInventoryZone,
  deleteEmptyInventoryZone,
  renameInventoryZone,
  setInventoryZoneActive,
} from "@/lib/server/inventory/zones";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getActionError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Unable to save zone settings. Try again.";
}

function redirectWithError(error: unknown): never {
  redirect(`/inventory/settings?error=${encodeURIComponent(getActionError(error))}`);
}

function refreshZonePages() {
  revalidatePath("/inventory/settings");
  revalidatePath("/inventory/new");
  revalidatePath("/inventory/stock");
  revalidatePath("/inventory");
  revalidatePath("/inventory/discs/[id]", "page");
}

export async function addInventoryZone(formData: FormData) {
  try {
    await createInventoryZone({
      code: getString(formData, "code"),
      label: getString(formData, "label"),
    });
  } catch (error) {
    redirectWithError(error);
  }

  refreshZonePages();
  redirect("/inventory/settings?notice=added");
}

export async function updateInventoryZoneLabel(formData: FormData) {
  try {
    await renameInventoryZone(getString(formData, "code"), getString(formData, "label"));
  } catch (error) {
    redirectWithError(error);
  }

  refreshZonePages();
  redirect("/inventory/settings?notice=updated");
}

export async function updateInventoryZoneStatus(formData: FormData) {
  const activeValue = getString(formData, "isActive");
  if (activeValue !== "true" && activeValue !== "false") {
    redirect("/inventory/settings?error=Select%20a%20valid%20zone%20status.");
  }
  const isActive = activeValue === "true";
  try {
    await setInventoryZoneActive(getString(formData, "code"), isActive);
  } catch (error) {
    redirectWithError(error);
  }

  refreshZonePages();
  redirect(`/inventory/settings?notice=${isActive ? "activated" : "deactivated"}`);
}

export async function permanentlyDeleteInventoryZone(formData: FormData) {
  try {
    await deleteEmptyInventoryZone(getString(formData, "code"));
  } catch (error) {
    redirectWithError(error);
  }
  refreshZonePages();
  redirect("/inventory/settings?notice=deleted");
}
