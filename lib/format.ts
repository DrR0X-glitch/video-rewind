import type { DiscFormat, InventoryItem, MediaType, MovieWithInventory } from "@/lib/types";
import { formatZoneLabel } from "@/lib/constants";

export function formatReleaseYear(date: string): string {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "Unknown" : parsed.getFullYear().toString();
}

export function formatLongDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return parsed.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return parsed.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatMovieTitleWithYear(title: string, date: string): string {
  const year = formatReleaseYear(date);
  return year === "Unknown" ? title : `${title} (${year})`;
}

export function formatImdbRating(imdbRating?: number): string {
  return typeof imdbRating === "number" && Number.isFinite(imdbRating)
    ? `${imdbRating.toFixed(1)}/10`
    : "—";
}

export function formatSeasonRange(seasonStart?: number, seasonEnd?: number): string {
  if (typeof seasonStart !== "number") {
    return "";
  }

  if (typeof seasonEnd !== "number" || seasonEnd === seasonStart) {
    return `Season ${seasonStart}`;
  }

  return `Seasons ${seasonStart}-${seasonEnd}`;
}

export function formatEpisodeRange(episodeStart?: number, episodeEnd?: number): string {
  if (typeof episodeStart !== "number") {
    return "";
  }

  if (typeof episodeEnd !== "number" || episodeEnd === episodeStart) {
    return `Episode ${episodeStart}`;
  }

  return `Episodes ${episodeStart}-${episodeEnd}`;
}

export function formatLinkedTitleLabel(input: {
  title: string;
  releaseDate: string;
  mediaType: MediaType;
  seasonStart?: number;
  seasonEnd?: number;
  episodeStart?: number;
  episodeEnd?: number;
}): string {
  const base = formatMovieTitleWithYear(input.title, input.releaseDate);

  if (input.mediaType !== "series") {
    return base;
  }

  const seasonRange = formatSeasonRange(input.seasonStart, input.seasonEnd);
  const episodeRange = formatEpisodeRange(input.episodeStart, input.episodeEnd);

  if (seasonRange && episodeRange) {
    return `${base} ${seasonRange} ${episodeRange}`;
  }

  if (seasonRange) {
    return `${base} ${seasonRange}`;
  }

  if (episodeRange) {
    return `${base} ${episodeRange}`;
  }

  return base;
}

export function formatMediaType(mediaType: MediaType): string {
  return mediaType === "series" ? "Series" : "Movie";
}

export function formatDiscFormat(format: DiscFormat): string {
  switch (format) {
    case "blu-ray":
      return "Blu-ray";
    case "4k-uhd":
      return "4K UHD";
    default:
      return "DVD";
  }
}

export function formatSealed(sealed: InventoryItem["sealed"]): string {
  return sealed ? "Sealed" : "Open";
}

export function getSealedTone(sealed: InventoryItem["sealed"]): "warn" | "muted" {
  return sealed ? "warn" : "muted";
}

export function formatInventoryLocation(item: InventoryItem): string {
  return `${item.zoneLabel ?? formatZoneLabel(item.zone)} / ${item.section}${item.row}`;
}

export function formatInventoryIdentifier(item: InventoryItem): string {
  return item.inventoryCode;
}

export function formatInventoryShortIdentifier(item: InventoryItem): string {
  return item.inventoryCode;
}

export function getAvailabilityLabel(movie: MovieWithInventory): string {
  if (movie.availableCount < 1) {
    return "Out of stock";
  }

  return `Available: ${movie.availableCount} / ${movie.totalCopies}`;
}

export function formatAvailability(availability: boolean): string {
  return availability ? "Available" : "Out";
}

export function getAvailabilityTone(availability: boolean): "good" | "muted" {
  return availability ? "good" : "muted";
}
