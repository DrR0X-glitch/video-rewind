import { parseInventoryZoneIdentifier } from "@/lib/inventory-zones";
import { createHttpError, optionalString } from "@/lib/server/http";

export function normalizeInventoryZone(value: unknown) {
  const raw = optionalString(value) ?? "";
  const normalized =
    raw.toLowerCase() === "shed"
      ? "S"
      : raw.toLowerCase() === "display"
        ? "D"
        : raw.toLowerCase() === "wall"
          ? "W"
          : raw.toUpperCase();

  const parsed = parseInventoryZoneIdentifier(normalized);
  if (!normalized) throw createHttpError(400, 'Field "zone" is required');
  if (!parsed) throw createHttpError(400, 'Field "zone" is invalid');
  return parsed;
}

export function normalizeInventoryLocationPart(value: unknown, fieldName: "section" | "row") {
  const normalized = optionalString(value)?.toUpperCase() ?? "";
  if (!normalized) throw createHttpError(400, `Field "${fieldName}" is required`);
  if (normalized.length > 2) {
    throw createHttpError(400, `Field "${fieldName}" must be 1 or 2 characters`);
  }
  return normalized;
}

export function normalizeInventoryRow(value: unknown) {
  const normalized = optionalString(value)?.toUpperCase() ?? "";
  if (!normalized) return "00";
  if (normalized.length > 2) {
    throw createHttpError(400, 'Field "row" must be 1 or 2 characters when provided');
  }
  return normalized;
}

export function buildInventoryLocationCode(zone: string, section: string, row: string) {
  return `${zone}/${section}${row}`;
}
