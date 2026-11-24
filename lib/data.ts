import "server-only";

import {
  getAlphabeticalStockSectionsFromDatabase,
  getMovieDetailFromDatabase,
  getMovieFiltersFromDatabase,
  getFeaturedMoviesFromDatabase,
  getHighestRatedMoviesFromDatabase,
  getHighestRatedMoviesByMediaTypeFromDatabase,
  getPopularMoviesFromDatabase,
  getPopularMoviesByMediaTypeFromDatabase,
  getPublicMovieDetailFromDatabase,
  getRecentlyReturnedMoviesFromDatabase,
  getStockViewOptionsFromDatabase,
  getTopGenresFromDatabase,
  listBrowseMoviesPageFromDatabase,
  listInventoryTitlesPageFromDatabase,
  listBrowseMoviesFromDatabase,
  listInventoryTitlesFromDatabase,
  listStockDiscsFromDatabase,
} from "@/lib/server/store";
import { fetchTmdbTitleDraft } from "@/lib/server/tmdb";
import type {
  MovieWithInventory,
  PublicMovieWithInventory,
  StockViewPage,
  StockViewSection,
} from "@/lib/types";

export function getSuggestedSortTitle(title: string): string {
  return title.replace(/^(a|an|the)\s+/i, "").trim() || title.trim();
}

export async function getBrowseFilters(): Promise<{
  genres: string[];
  years: number[];
}> {
  return getMovieFiltersFromDatabase();
}

export async function filterMovies(input: {
  search?: string;
  genre?: string;
  decade?: string;
  available?: string;
  mediaType?: string;
  excludeHomepageHidden?: boolean;
  limit?: number;
  sort?: string;
}): Promise<MovieWithInventory[]> {
  return listBrowseMoviesFromDatabase(input);
}

export async function getMovieById(id: string): Promise<MovieWithInventory> {
  return getMovieDetailFromDatabase(id);
}

export async function getPublicMovieById(id: string): Promise<PublicMovieWithInventory> {
  return getPublicMovieDetailFromDatabase(id);
}

export async function getFeaturedMovies(): Promise<MovieWithInventory[]> {
  return getFeaturedMoviesFromDatabase();
}

export async function getRecentlyReturnedMovies(limit?: number): Promise<MovieWithInventory[]> {
  return getRecentlyReturnedMoviesFromDatabase(limit);
}

export async function getHighestRatedMovies(limit?: number): Promise<MovieWithInventory[]> {
  return getHighestRatedMoviesFromDatabase(limit);
}

export async function getHighestRatedMoviesByMediaType(
  mediaType: "movie" | "series",
  limit?: number,
): Promise<MovieWithInventory[]> {
  return getHighestRatedMoviesByMediaTypeFromDatabase(mediaType, limit);
}

export async function getPopularMovies(limit?: number): Promise<MovieWithInventory[]> {
  return getPopularMoviesFromDatabase(limit);
}

export async function getPopularMoviesByMediaType(
  mediaType: "movie" | "series",
  limit?: number,
): Promise<MovieWithInventory[]> {
  return getPopularMoviesByMediaTypeFromDatabase(mediaType, limit);
}

export async function getTopGenres(
  limit?: number,
  options?: { excludeHomepageHidden?: boolean },
): Promise<string[]> {
  return getTopGenresFromDatabase(limit, options);
}

export async function searchInventoryTitles(
  query?: string,
  limit?: number,
): Promise<MovieWithInventory[]> {
  return listInventoryTitlesFromDatabase(query, limit);
}

export async function searchInventoryTitlesPage(query?: string, page?: number, pageSize?: number) {
  return listInventoryTitlesPageFromDatabase(query, page, pageSize);
}

export async function filterMoviesPage(input: {
  search?: string;
  genre?: string;
  decade?: string;
  available?: string;
  mediaType?: string;
  excludeHomepageHidden?: boolean;
  limit?: number;
  page?: number;
  pageSize?: number;
  sort?: string;
}) {
  return listBrowseMoviesPageFromDatabase({
    search: input.search,
    genre: input.genre,
    decade: input.decade,
    available: input.available,
    mediaType: input.mediaType,
    excludeHomepageHidden: input.excludeHomepageHidden,
    limit: input.limit,
    page: input.page,
    pageSize: input.pageSize,
    sort: input.sort,
  });
}

export async function getTmdbMovieDraft(input: string) {
  return fetchTmdbTitleDraft(input);
}

export async function getAlphabeticalStockSections(input: {
  zone?: string;
  zones?: string[];
  formats?: string[];
  view?: string;
}): Promise<StockViewSection[]> {
  return getAlphabeticalStockSectionsFromDatabase(input);
}

export async function listStockDiscs(input: {
  preset?: string;
  q?: string;
  section?: string;
  row?: string;
  availability?: string;
  edited?: string;
  formats?: string[];
  excludeFormats?: string[];
  primary?: string;
  zones?: string[];
  sealedStates?: string[];
  reviewedState?: string;
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
}): Promise<StockViewPage> {
  return listStockDiscsFromDatabase(input);
}

export async function getStockViewOptions() {
  return getStockViewOptionsFromDatabase();
}
