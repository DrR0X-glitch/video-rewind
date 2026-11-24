export class ReleaseYearInputError extends Error {
  constructor() {
    super("Enter a four-digit release year between 1000 and 9999.");
    this.name = "ReleaseYearInputError";
  }
}

export function normalizeReleaseYearInput(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 1000 && value <= 9999) return value;
    throw new ReleaseYearInputError();
  }

  if (typeof value !== "string") throw new ReleaseYearInputError();
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d{4}$/.test(normalized)) throw new ReleaseYearInputError();
  const year = Number(normalized);
  if (year < 1000 || year > 9999) throw new ReleaseYearInputError();
  return year;
}
