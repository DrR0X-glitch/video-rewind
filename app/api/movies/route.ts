import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { filterMoviesPage } from "@/lib/data";
import {
  ensureObject,
  jsonError,
  parseBoolean,
  parseInteger,
  requireString,
} from "@/lib/server/http";
import { createMovieInDatabase } from "@/lib/server/store";

function parseDecade(value: string | null) {
  if (value === null) {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (!normalizedValue) {
    return undefined;
  }

  if (normalizedValue === "pre-1950") {
    return normalizedValue;
  }

  if (/^\d{4}$/.test(normalizedValue)) {
    return parseInteger(normalizedValue, "decade") ?? undefined;
  }

  const shortMatch = normalizedValue.match(/^(\d{2})s$/);

  if (!shortMatch) {
    return undefined;
  }

  const shortValue = Number.parseInt(shortMatch[1] ?? "", 10);

  if (Number.isNaN(shortValue)) {
    return undefined;
  }

  return shortValue >= 30 ? 1900 + shortValue : 2000 + shortValue;
}

export async function GET(request: NextRequest) {
  try {
    const filters = {
      search: request.nextUrl.searchParams.get("search")?.trim() || undefined,
      genre: request.nextUrl.searchParams.get("genre")?.trim() || undefined,
      decade: parseDecade(request.nextUrl.searchParams.get("decade")),
      available: parseBoolean(request.nextUrl.searchParams.get("available"), "available"),
      page: parseInteger(request.nextUrl.searchParams.get("page"), "page") ?? undefined,
      pageSize: parseInteger(request.nextUrl.searchParams.get("pageSize"), "pageSize") ?? undefined,
      sort: request.nextUrl.searchParams.get("sort")?.trim() || undefined,
    };

    const movies = await filterMoviesPage({
      search: filters.search,
      genre: filters.genre,
      decade:
        typeof filters.decade === "number" || filters.decade === "pre-1950"
          ? filters.decade.toString()
          : undefined,
      available: filters.available ? "true" : undefined,
      page: filters.page,
      pageSize: filters.pageSize,
      sort: filters.sort,
    });
    return NextResponse.json(movies);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = ensureObject(await request.json());
    const parsedImdbRating =
      typeof body.imdb_rating === "number"
        ? body.imdb_rating
        : typeof body.imdb_rating === "string" && body.imdb_rating.trim() !== ""
          ? Number.parseFloat(body.imdb_rating)
          : undefined;
    const collectionInput: Record<string, unknown> | null =
      body.collection && typeof body.collection === "object" && !Array.isArray(body.collection)
        ? (body.collection as Record<string, unknown>)
        : null;

    const movieId = await createMovieInDatabase({
      tmdbId: requireString(body.tmdb_id, "tmdb_id"),
      imdbId: typeof body.imdb_id === "string" ? body.imdb_id : undefined,
      imdbRating:
        typeof parsedImdbRating === "number" && Number.isFinite(parsedImdbRating)
          ? parsedImdbRating
          : undefined,
      mediaType:
        typeof body.media_type === "string" && body.media_type.trim() !== ""
          ? body.media_type
          : "movie",
      title: requireString(body.title, "title"),
      sortTitle: requireString(body.sort_title, "sort_title"),
      overview: typeof body.overview === "string" ? body.overview : "",
      releaseDate: typeof body.release_date === "string" ? body.release_date : "",
      posterPath: typeof body.poster_path === "string" ? body.poster_path : null,
      genres: Array.isArray(body.genres)
        ? body.genres.filter((value): value is string => typeof value === "string")
        : [],
      director: typeof body.director === "string" ? body.director : "",
      cast: Array.isArray(body.cast)
        ? body.cast.flatMap((member) =>
            member &&
            typeof member === "object" &&
            typeof member.name === "string" &&
            typeof member.character === "string"
              ? [{ name: member.name, character: member.character }]
              : [],
          )
        : [],
      collection:
        collectionInput &&
        typeof collectionInput.tmdbId === "string" &&
        typeof collectionInput.name === "string"
          ? {
              tmdbId: collectionInput.tmdbId,
              name: collectionInput.name,
              overview:
                typeof collectionInput.overview === "string" ? collectionInput.overview : "",
              posterPath:
                typeof collectionInput.posterPath === "string" ? collectionInput.posterPath : null,
              titles: Array.isArray(collectionInput.titles)
                ? collectionInput.titles.flatMap((title) =>
                    title &&
                    typeof title === "object" &&
                    typeof title.tmdbId === "string" &&
                    typeof title.title === "string"
                      ? [
                          {
                            tmdbId: title.tmdbId,
                            mediaType: "movie" as const,
                            title: title.title,
                            sortTitle:
                              typeof title.sortTitle === "string" ? title.sortTitle : title.title,
                            overview: typeof title.overview === "string" ? title.overview : "",
                            releaseDate:
                              typeof title.releaseDate === "string" ? title.releaseDate : "",
                            posterPath:
                              typeof title.posterPath === "string" ? title.posterPath : null,
                          },
                        ]
                      : [],
                  )
                : [],
            }
          : null,
    });

    return NextResponse.json({ id: movieId }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
