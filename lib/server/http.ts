import "server-only";

import { NextResponse } from "next/server";

import type { MediaType } from "@/lib/types";

const tmdbImageBaseUrls = {
  list: "https://image.tmdb.org/t/p/w200",
  detail: "https://image.tmdb.org/t/p/w500",
};

export function createHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

export function jsonError(error: unknown) {
  console.error(error);

  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export function ensureObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createHttpError(400, "Request body must be a JSON object");
  }

  return value as Record<string, unknown>;
}

export function parseBoolean(value: string | null, fieldName: string) {
  if (value === null) {
    return false;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw createHttpError(400, `Query parameter "${fieldName}" must be true or false`);
}

export function parseInteger(value: string | null, fieldName: string) {
  if (value === null) {
    return null;
  }

  const parsedValue = Number.parseInt(value, 10);

  if (Number.isNaN(parsedValue)) {
    throw createHttpError(400, `Query parameter "${fieldName}" must be an integer`);
  }

  return parsedValue;
}

export function normalizeSealed(value: unknown, fieldName = "sealed") {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === "true" || normalizedValue === "sealed" || normalizedValue === "yes") {
      return true;
    }

    if (
      normalizedValue === "false" ||
      normalizedValue === "not-sealed" ||
      normalizedValue === "no"
    ) {
      return false;
    }
  }

  throw createHttpError(400, `Field "${fieldName}" is invalid`);
}

export function normalizeFormat(value: unknown) {
  const normalizedValue = normalizeEnumValue(value, "format");
  const allowedFormats = new Set(["dvd", "blu-ray", "4k-uhd", "vhs"]);

  if (!allowedFormats.has(normalizedValue)) {
    throw createHttpError(400, 'Field "format" is invalid');
  }

  return normalizedValue;
}

export function normalizeAvailability(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === "true" || normalizedValue === "available") {
      return true;
    }

    if (normalizedValue === "false" || normalizedValue === "out") {
      return false;
    }
  }

  throw createHttpError(400, 'Field "availability" is invalid');
}

export function normalizeMoney(value: unknown, fieldName: string) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw createHttpError(400, `Field "${fieldName}" is invalid`);
}

export function normalizeLateClass(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  throw createHttpError(400, 'Field "late_class" is invalid');
}

export function normalizeMediaType(value: unknown): MediaType {
  const normalizedValue = normalizeEnumValue(value, "media_type");

  if (normalizedValue !== "movie" && normalizedValue !== "series") {
    throw createHttpError(400, 'Field "media_type" is invalid');
  }

  return normalizedValue;
}

export function optionalString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw createHttpError(400, "Expected string fields in request body");
  }

  return value.trim();
}

export function requireString(value: unknown, fieldName: string) {
  const normalizedValue = optionalString(value);

  if (!normalizedValue) {
    throw createHttpError(400, `Field "${fieldName}" is required`);
  }

  return normalizedValue;
}

export function formatDateOnly(value: string | Date | null) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

export function formatTimestamp(value: string | Date | null) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export function formatPosterUrl(path: string | null, size: keyof typeof tmdbImageBaseUrls) {
  if (!path) {
    return null;
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${tmdbImageBaseUrls[size]}${path}`;
}

export function normalizeCast(castMembers: unknown) {
  if (!Array.isArray(castMembers)) {
    return [];
  }

  return castMembers.map((member) => ({
    name: typeof member?.name === "string" ? member.name : "",
    character: typeof member?.character === "string" ? member.character : "",
  }));
}

function normalizeEnumValue(value: unknown, fieldName: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw createHttpError(400, `Field "${fieldName}" must be a non-empty string`);
  }

  return value.trim().toLowerCase();
}

export function formatInventoryFormat(value: string) {
  if (value === "4k-uhd") {
    return "4K UHD";
  }

  if (value === "blu-ray") {
    return "Blu-ray";
  }

  return value.toUpperCase();
}
