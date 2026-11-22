export type InventoryZone = {
  code: string;
  label: string;
  isActive: boolean;
};

export function parseInventoryZoneCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,4}$/.test(code) ? code : null;
}

export function parseInventoryZoneIdentifier(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const code = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9 _-]{0,31}$/.test(code) ? code : null;
}

export function parseInventoryZoneLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const label = value.trim();
  return label.length > 0 && label.length <= 40 ? label : null;
}
