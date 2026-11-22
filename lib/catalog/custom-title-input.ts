import type { MediaType } from "@/lib/types";

export type CustomTitleInput = {
  title: unknown;
  sortTitle?: unknown;
  mediaType: unknown;
  releaseDate?: unknown;
  overview?: unknown;
  genres?: unknown;
  director?: unknown;
};

export type NormalizedCustomTitle = {
  title: string;
  sortTitle: string;
  mediaType: MediaType;
  releaseDate: string | null;
  overview: string;
  genres: string[];
  director: string;
};

export class CustomTitleInputError extends Error {
  constructor(
    readonly field: "title" | "mediaType" | "releaseDate" | "overview" | "genres" | "director",
    message: string,
  ) {
    super(message);
    this.name = "CustomTitleInputError";
  }
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getSuggestedSortTitle(title: string) {
  return title.replace(/^(a|an|the)\s+/i, "").trim() || title;
}

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeCustomTitleInput(input: CustomTitleInput): NormalizedCustomTitle {
  const title = readOptionalString(input.title);
  const mediaType = readOptionalString(input.mediaType);
  const sortTitle = readOptionalString(input.sortTitle);
  const releaseDate = readOptionalString(input.releaseDate);
  const overview = readOptionalString(input.overview);
  const genresText = readOptionalString(input.genres);
  const director = readOptionalString(input.director);

  if (!title) {
    throw new CustomTitleInputError("title", "Enter a title.");
  }
  if (title.length > 200) {
    throw new CustomTitleInputError("title", "Title must be 200 characters or fewer.");
  }

  if (mediaType !== "movie" && mediaType !== "series") {
    throw new CustomTitleInputError("mediaType", "Choose Movie or TV series.");
  }

  if (releaseDate && !isValidDateOnly(releaseDate)) {
    throw new CustomTitleInputError("releaseDate", "Enter a valid release date.");
  }
  if (overview.length > 5000) {
    throw new CustomTitleInputError("overview", "Overview must be 5,000 characters or fewer.");
  }
  if (director.length > 200) {
    throw new CustomTitleInputError(
      "director",
      "Director or creator must be 200 characters or fewer.",
    );
  }

  const seenGenres = new Set<string>();
  const genres = genresText
    .split(",")
    .map((genre) => genre.trim())
    .filter((genre) => {
      const key = genre.toLocaleLowerCase();
      if (!genre || seenGenres.has(key)) {
        return false;
      }
      seenGenres.add(key);
      return true;
    });
  if (genres.length > 20 || genres.some((genre) => genre.length > 60)) {
    throw new CustomTitleInputError(
      "genres",
      "Enter up to 20 genres, each 60 characters or fewer.",
    );
  }

  return {
    title,
    sortTitle: sortTitle || getSuggestedSortTitle(title),
    mediaType,
    releaseDate: releaseDate || null,
    overview,
    genres,
    director,
  };
}
