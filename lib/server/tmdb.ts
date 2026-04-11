import type { MediaType } from "@/lib/types";
import { createHttpError } from "@/lib/server/http";

type TmdbTitleDetailsResponse = {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  release_date?: string;
  first_air_date?: string;
  poster_path: string | null;
  genres?: Array<{ id: number; name: string }>;
  credits?: {
    cast?: Array<{ name: string; character: string }>;
    crew?: Array<{ name: string; job: string }>;
  };
  created_by?: Array<{ name: string }>;
  belongs_to_collection?: {
    id: number;
    name: string;
    poster_path: string | null;
  } | null;
  external_ids?: {
    imdb_id?: string | null;
  };
};

type TmdbCollectionDetailsResponse = {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  parts?: Array<{
    id: number;
    title: string;
    overview: string;
    release_date?: string;
    poster_path: string | null;
  }>;
};

export type TmdbCollectionDraft = {
  tmdbId: string;
  name: string;
  overview: string;
  posterPath: string | null;
  titles: Array<{
    tmdbId: string;
    mediaType: "movie";
    title: string;
    sortTitle: string;
    overview: string;
    releaseDate: string;
    posterPath: string | null;
  }>;
};

export type TmdbTitleDraft = {
  tmdbId: string;
  imdbId: string;
  mediaType: MediaType;
  title: string;
  sortTitle: string;
  overview: string;
  releaseDate: string;
  posterPath: string | null;
  genres: string[];
  director: string;
  cast: Array<{ name: string; character: string }>;
  collection: TmdbCollectionDraft | null;
};

function getTmdbToken() {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN;

  if (!token) {
    throw createHttpError(500, "TMDB_API_READ_ACCESS_TOKEN is not configured");
  }

  return token;
}

function getSuggestedSortTitle(title: string) {
  return title.replace(/^(a|an|the)\s+/i, "").trim() || title.trim();
}

function compareCollectionParts(
  a: NonNullable<TmdbCollectionDetailsResponse["parts"]>[number],
  b: NonNullable<TmdbCollectionDetailsResponse["parts"]>[number],
) {
  const aTime = a.release_date ? new Date(a.release_date).getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.release_date ? new Date(b.release_date).getTime() : Number.MAX_SAFE_INTEGER;

  if (aTime !== bTime) {
    return aTime - bTime;
  }

  return a.title.localeCompare(b.title);
}

function parseTmdbInput(input: string): { id: string; mediaType: MediaType } {
  const trimmed = input.trim();

  if (/^\d+$/.test(trimmed)) {
    return { id: trimmed, mediaType: "movie" };
  }

  const movieMatch = trimmed.match(/themoviedb\.org\/movie\/(\d+)/i);
  if (movieMatch) {
    return { id: movieMatch[1], mediaType: "movie" };
  }

  const tvMatch = trimmed.match(/themoviedb\.org\/tv\/(\d+)/i);
  if (tvMatch) {
    return { id: tvMatch[1], mediaType: "series" };
  }

  throw createHttpError(400, "Enter a valid TMDB movie or TV URL, or a numeric TMDB movie id");
}

export async function fetchTmdbTitleDraft(input: string): Promise<TmdbTitleDraft> {
  const parsed = parseTmdbInput(input);
  const token = getTmdbToken();
  const tmdbPath = parsed.mediaType === "series" ? "tv" : "movie";

  const response = await fetch(
    `https://api.themoviedb.org/3/${tmdbPath}/${parsed.id}?append_to_response=credits,external_ids`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    throw createHttpError(404, "TMDB title not found");
  }

  if (!response.ok) {
    throw createHttpError(502, "TMDB request failed");
  }

  const title = (await response.json()) as TmdbTitleDetailsResponse;
  const normalizedTitle = title.title ?? title.name ?? "";
  const director =
    parsed.mediaType === "series"
      ? title.created_by?.[0]?.name ?? ""
      : title.credits?.crew?.find((member) => member.job === "Director")?.name ?? "";

  return {
    tmdbId: title.id.toString(),
    imdbId: title.external_ids?.imdb_id ?? "",
    mediaType: parsed.mediaType,
    title: normalizedTitle,
    sortTitle: getSuggestedSortTitle(normalizedTitle),
    overview: title.overview ?? "",
    releaseDate: title.release_date ?? title.first_air_date ?? "",
    posterPath: title.poster_path,
    genres: title.genres?.map((genre) => genre.name) ?? [],
    director,
    cast:
      title.credits?.cast?.slice(0, 6).map((member) => ({
        name: member.name,
        character: member.character,
      })) ?? [],
    collection:
      parsed.mediaType === "movie" && title.belongs_to_collection
        ? await fetchTmdbCollectionDraft(title.belongs_to_collection.id.toString(), token)
        : null,
  };
}

async function fetchTmdbCollectionDraft(
  collectionId: string,
  token: string,
): Promise<TmdbCollectionDraft | null> {
  try {
    const response = await fetch(`https://api.themoviedb.org/3/collection/${collectionId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const collection = (await response.json()) as TmdbCollectionDetailsResponse;

    return {
      tmdbId: collection.id.toString(),
      name: collection.name,
      overview: collection.overview ?? "",
      posterPath: collection.poster_path,
      titles:
        collection.parts
          ?.slice()
          .sort(compareCollectionParts)
          .map((part) => ({
            tmdbId: part.id.toString(),
            mediaType: "movie" as const,
            title: part.title,
            sortTitle: getSuggestedSortTitle(part.title),
            overview: part.overview ?? "",
            releaseDate: part.release_date ?? "",
            posterPath: part.poster_path,
          })) ?? [],
    };
  } catch {
    return null;
  }
}
