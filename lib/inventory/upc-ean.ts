export class UpcEanInputError extends Error {
  constructor() {
    super('Field "upc_ean" must contain 8, 12, 13, or 14 digits');
    this.name = "UpcEanInputError";
  }
}

export function normalizeUpcEanInput(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new UpcEanInputError();
  const normalized = value.trim().replace(/[\s-]/g, "");
  if (!normalized) return null;
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(normalized)) {
    throw new UpcEanInputError();
  }
  return normalized;
}
