import type { MediaType } from "@/lib/types";
import { normalizeReleaseYearInput, ReleaseYearInputError } from "@/lib/catalog/release-year-input";

export type CustomTitleInput = {
  title: unknown;
  sortTitle?: unknown;
  mediaType: unknown;
  releaseYear?: unknown;
  overview?: unknown;
  genres?: unknown;
  director?: unknown;
};

export type NormalizedCustomTitle = {
  title: string;
  sortTitle: string;
  mediaType: MediaType;
  releaseYear: number;
  overview: string;
  genres: string[];
  director: string;
};

export class CustomTitleInputError extends Error {
  constructor(
    readonly field:
      "title" | "sortTitle" | "mediaType" | "releaseYear" | "overview" | "genres" | "director",
    message: string,
  ) {
    super(message);
    this.name = "CustomTitleInputError";
  }
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCustomTitleInput(input: CustomTitleInput): NormalizedCustomTitle {
  const title = readOptionalString(input.title);
  const mediaType = readOptionalString(input.mediaType);
  const sortTitle = readOptionalString(input.sortTitle);
  const overview = readOptionalString(input.overview);
  const genresText = readOptionalString(input.genres);
  const director = readOptionalString(input.director);

  if (!title) {
    throw new CustomTitleInputError("title", "Enter a title.");
  }
  if (title.length > 200) {
    throw new CustomTitleInputError("title", "Title must be 200 characters or fewer.");
  }

  if (!sortTitle) {
    throw new CustomTitleInputError("sortTitle", "Enter a sort title.");
  }
  if (sortTitle.length > 200) {
    throw new CustomTitleInputError("sortTitle", "Sort title must be 200 characters or fewer.");
  }

  if (mediaType !== "movie" && mediaType !== "series") {
    throw new CustomTitleInputError("mediaType", "Choose Movie or TV series.");
  }

  let releaseYear: number | null;
  try {
    releaseYear = normalizeReleaseYearInput(input.releaseYear);
  } catch (error) {
    if (error instanceof ReleaseYearInputError) {
      throw new CustomTitleInputError("releaseYear", error.message);
    }
    throw error;
  }
  if (releaseYear === null) {
    throw new CustomTitleInputError("releaseYear", "Enter a release year.");
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
    sortTitle,
    mediaType,
    releaseYear,
    overview,
    genres,
    director,
  };
}
