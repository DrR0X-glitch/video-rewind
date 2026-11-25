import "server-only";

import { formatZoneLabel } from "@/lib/constants";
import { normalizeReleaseYearInput, ReleaseYearInputError } from "@/lib/catalog/release-year-input";
import { pool } from "@/lib/server/db";
import { fetchOmdbTitleMetadataByImdbId } from "@/lib/server/omdb";
import {
  normalizeInventoryLocationPart as normalizeLocationPart,
  normalizeInventoryRow as normalizeRowPart,
  normalizeInventoryZone as normalizeZone,
} from "@/lib/server/inventory/location-input";
import { assertInventoryZoneIsAssignable } from "@/lib/server/inventory/zones";
import {
  createHttpError,
  formatDateOnly,
  formatTimestamp,
  formatPosterUrl,
  normalizeAvailability,
  normalizeCast,
  normalizeMediaType,
  optionalString,
} from "@/lib/server/http";
import type {
  InventoryItem,
  LinkedTitle,
  MovieWithInventory,
  PublicInventoryItem,
  PublicMovieWithInventory,
  TitleCollection,
} from "@/lib/types";
import type { TmdbCollectionDraft } from "@/lib/server/tmdb";

type MovieFilters = {
  search?: string;
  genre?: string;
  decade?: number | "pre-1950" | null;
  available?: boolean;
  reviewedOnly?: boolean;
  publicOnly?: boolean;
  mediaType?: "movie" | "series";
  excludeHomepageHidden?: boolean;
  limit?: number;
  page?: number;
  pageSize?: number;
  sort?: "title" | "rating-desc" | "popular" | "year-desc" | "year-asc";
};

const TITLE_SEARCH_VECTOR_SQL = `
  (
    setweight(to_tsvector('simple', COALESCE(t.title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(t.sort_title, '')), 'A')
  )
`;

const PUBLIC_FORMATS_SQL = "i.format IN ('dvd', 'blu-ray', '4k-uhd')";

function isPublicInventoryItem(item: InventoryItem): item is PublicInventoryItem {
  return item.format === "dvd" || item.format === "blu-ray" || item.format === "4k-uhd";
}

const TITLE_METADATA_SEARCH_VECTOR_SQL = `
  (
    setweight(to_tsvector('simple', COALESCE(t.director, '')), 'B') ||
    setweight(to_tsvector('simple', array_to_string(COALESCE(t.genres, '{}'::text[]), ' ')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(t.overview, '')), 'C') ||
    setweight(
      to_tsvector(
        'simple',
        COALESCE(
          (
            SELECT string_agg(
              trim(COALESCE(cast_member->>'name', '') || ' ' || COALESCE(cast_member->>'character', '')),
              ' '
            )
            FROM jsonb_array_elements(t.cast_members) AS cast_member
          ),
          ''
        )
      ),
      'C'
    )
  )
`;

function tokenizeSearchQuery(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildPrefixTsQuery(query: string) {
  const tokens = tokenizeSearchQuery(query);

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `${token}:*`).join(" & ");
}

type TitleRow = {
  id: string;
  tmdb_id: number | null;
  imdb_id: string | null;
  imdb_rating: string | number | null;
  media_type: "movie" | "series";
  title: string;
  sort_title: string;
  overview: string;
  release_date: string | Date | null;
  release_year: number;
  poster_path: string | null;
  genres: string[] | null;
  director: string;
  cast_members: unknown;
  featured: boolean;
  hide_from_homepage: boolean;
  available_count: number;
  total_copies: number;
  total_count?: number;
  search_rank?: number;
};

type InventoryItemRow = {
  id: string;
  inventory_code: string | null;
  upc_ean: string | null;
  format: string;
  sealed: boolean;
  availability: boolean;
  reviewed: boolean;
  zone: string;
  zone_label: string | null;
  section: string;
  row: string;
  location_code: string;
  notes: string;
  last_rented_at: string | Date | null;
  day_price: string | number;
  weekend_price: string | number;
  late_class: number;
  updated_at: string | Date | null;
  linked_titles?: Array<{
    id: string;
    title: string;
    sort_title?: string | null;
    media_type: "movie" | "series";
    release_date: string | Date | null;
    release_year: number;
    poster_path?: string | null;
    season_start?: number | null;
    season_end?: number | null;
    episode_start?: number | null;
    episode_end?: number | null;
  }>;
  linked_music_release?: {
    id: string;
    source: "discogs" | "manual";
    discogs_release_id: string | number | null;
    title: string;
    sort_title: string;
    artist_credit: string;
    release_year: number | null;
    discogs_url: string | null;
  } | null;
};

type CollectionRow = {
  id: string;
  tmdb_collection_id: number;
  name: string;
  poster_path: string | null;
};

type CollectionTitleRow = {
  collection_id: string;
  collection_name: string;
  collection_poster_path: string | null;
  id: string;
  title: string;
  sort_title: string;
  media_type: "movie" | "series";
  release_date: string | Date | null;
  release_year: number;
};

function getSuggestedSortTitle(title: string) {
  return title.replace(/^(a|an|the)\s+/i, "").trim() || title.trim();
}

function getPosterColor(title: string) {
  const palette = ["#3454b4", "#7b5d43", "#8d2f2b", "#223724", "#d0893d", "#5a6778"];
  const total = Array.from(title).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[total % palette.length];
}

function toUiLinkedTitle(title: {
  id: string;
  title: string;
  sort_title?: string | null;
  media_type: "movie" | "series";
  release_date: string | Date | null;
  release_year: number;
  poster_path?: string | null;
  season_start?: number | null;
  season_end?: number | null;
  episode_start?: number | null;
  episode_end?: number | null;
}): LinkedTitle {
  return {
    id: title.id,
    title: title.title,
    sortTitle: title.sort_title || getSuggestedSortTitle(title.title),
    mediaType: title.media_type,
    releaseDate: formatDateOnly(title.release_date) ?? "",
    releaseYear: Number(title.release_year),
    posterUrl: formatPosterUrl(title.poster_path ?? null, "list"),
    seasonStart: typeof title.season_start === "number" ? title.season_start : undefined,
    seasonEnd: typeof title.season_end === "number" ? title.season_end : undefined,
    episodeStart: typeof title.episode_start === "number" ? title.episode_start : undefined,
    episodeEnd: typeof title.episode_end === "number" ? title.episode_end : undefined,
  };
}

function toUiInventoryItem(item: InventoryItemRow): InventoryItem {
  return {
    id: item.id,
    inventoryCode: item.inventory_code ?? "",
    upcEan: item.upc_ean,
    format:
      item.format.toLowerCase() === "blu-ray"
        ? "blu-ray"
        : item.format.toLowerCase() === "4k-uhd"
          ? "4k-uhd"
          : item.format.toLowerCase() === "vhs"
            ? "vhs"
            : item.format.toLowerCase() === "cd"
              ? "cd"
              : "dvd",
    sealed: Boolean(item.sealed),
    availability: item.availability,
    reviewed: item.reviewed,
    zone: item.zone,
    zoneLabel: item.zone_label ?? formatZoneLabel(item.zone),
    section: item.section,
    row: item.row,
    locationCode: item.location_code,
    linkedTitles: Array.isArray(item.linked_titles) ? item.linked_titles.map(toUiLinkedTitle) : [],
    linkedMusicRelease: item.linked_music_release
      ? {
          id: item.linked_music_release.id,
          source: item.linked_music_release.source,
          discogsReleaseId:
            item.linked_music_release.discogs_release_id === null
              ? null
              : Number(item.linked_music_release.discogs_release_id),
          title: item.linked_music_release.title,
          sortTitle: item.linked_music_release.sort_title,
          artistCredit: item.linked_music_release.artist_credit,
          releaseYear: item.linked_music_release.release_year,
          discogsUrl: item.linked_music_release.discogs_url,
        }
      : undefined,
    notes: item.notes,
    lastRentedAt: formatDateOnly(item.last_rented_at) ?? undefined,
    dayPrice: Number(item.day_price),
    weekendPrice: Number(item.weekend_price),
    lateClass: item.late_class,
    updatedAt: formatTimestamp(item.updated_at) ?? undefined,
  };
}

function toUiTitle(row: TitleRow, inventoryItems: InventoryItem[] = []): MovieWithInventory {
  const imdbRating =
    row.imdb_rating === null || row.imdb_rating === undefined
      ? undefined
      : Number.isFinite(Number(row.imdb_rating))
        ? Number(row.imdb_rating)
        : undefined;

  return {
    id: row.id,
    tmdbId: row.tmdb_id?.toString() ?? "",
    imdbId: row.imdb_id ?? undefined,
    imdbRating,
    mediaType: row.media_type,
    title: row.title,
    sortTitle: row.sort_title || getSuggestedSortTitle(row.title),
    overview: row.overview ?? "",
    releaseDate: formatDateOnly(row.release_date) ?? "",
    releaseYear: Number(row.release_year),
    posterUrl: formatPosterUrl(row.poster_path, "detail"),
    posterColor: getPosterColor(row.title),
    genres: row.genres ?? [],
    director:
      row.director || (row.media_type === "series" ? "Creator pending" : "Director pending"),
    cast: normalizeCast(row.cast_members)
      .map((member) => member.name)
      .filter(Boolean),
    inventoryItems,
    availableCount: row.available_count,
    totalCopies: row.total_copies,
    featured: row.featured,
    hideFromHomepage: row.hide_from_homepage,
    collectionTitles: [],
  };
}

function toUiCollection(row: CollectionRow): TitleCollection {
  return {
    id: row.id,
    name: row.name,
    posterUrl: formatPosterUrl(row.poster_path, "list"),
  };
}

function buildListTitlesQuery(filters: MovieFilters) {
  const conditions = [];
  const values: Array<string | number> = [];
  let searchRankSql = "0";
  const normalizedPageSize =
    typeof filters.pageSize === "number" &&
    Number.isInteger(filters.pageSize) &&
    filters.pageSize > 0
      ? filters.pageSize
      : undefined;
  const normalizedPage =
    typeof filters.page === "number" && Number.isInteger(filters.page) && filters.page > 0
      ? filters.page
      : 1;

  if (filters.search) {
    const normalizedSearch = filters.search.trim().toLowerCase();
    const prefixTsQuery = buildPrefixTsQuery(normalizedSearch);
    const allowMetadataMatches = normalizedSearch.length >= 3 && prefixTsQuery !== null;

    values.push(normalizedSearch);
    const exactIndex = values.length;
    values.push(`${normalizedSearch}%`);
    const prefixIndex = values.length;
    values.push(`%${normalizedSearch}%`);
    const containsIndex = values.length;
    const titleTsIndex = prefixTsQuery ? (values.push(prefixTsQuery), values.length) : null;
    const metadataTsIndex =
      allowMetadataMatches && prefixTsQuery ? (values.push(prefixTsQuery), values.length) : null;

    conditions.push(`
      (
        LOWER(t.title) = $${exactIndex}
        OR LOWER(t.sort_title) = $${exactIndex}
        OR LOWER(t.title) LIKE $${prefixIndex}
        OR LOWER(t.sort_title) LIKE $${prefixIndex}
        OR LOWER(t.title) LIKE $${containsIndex}
        OR LOWER(t.sort_title) LIKE $${containsIndex}
        ${titleTsIndex ? `OR ${TITLE_SEARCH_VECTOR_SQL} @@ to_tsquery('simple', $${titleTsIndex})` : ""}
        ${
          metadataTsIndex
            ? `OR ${TITLE_METADATA_SEARCH_VECTOR_SQL} @@ to_tsquery('simple', $${metadataTsIndex})`
            : ""
        }
      )
    `);

    searchRankSql = `
      (
        CASE
          WHEN LOWER(t.title) = $${exactIndex} OR LOWER(t.sort_title) = $${exactIndex}
            THEN 400
          ELSE 0
        END
        + CASE
          WHEN LOWER(t.title) LIKE $${prefixIndex} OR LOWER(t.sort_title) LIKE $${prefixIndex}
            THEN 220
          ELSE 0
        END
        + CASE
          WHEN ${titleTsIndex ? `${TITLE_SEARCH_VECTOR_SQL} @@ to_tsquery('simple', $${titleTsIndex})` : "FALSE"}
            THEN 120 + (
              ${
                titleTsIndex
                  ? `ts_rank_cd(${TITLE_SEARCH_VECTOR_SQL}, to_tsquery('simple', $${titleTsIndex})) * 100`
                  : "0"
              }
            )
          ELSE 0
        END
        + CASE
          WHEN LOWER(t.title) LIKE $${containsIndex} OR LOWER(t.sort_title) LIKE $${containsIndex}
            THEN 30
          ELSE 0
        END
        + CASE
          WHEN ${
            metadataTsIndex
              ? `${TITLE_METADATA_SEARCH_VECTOR_SQL} @@ to_tsquery('simple', $${metadataTsIndex})`
              : "FALSE"
          }
            THEN 20 + (
              ${
                metadataTsIndex
                  ? `ts_rank_cd(${TITLE_METADATA_SEARCH_VECTOR_SQL}, to_tsquery('simple', $${metadataTsIndex})) * 20`
                  : "0"
              }
            )
          ELSE 0
        END
      )
    `;
  }

  if (filters.genre) {
    values.push(filters.genre.toLowerCase());
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM UNNEST(t.genres) AS genre
        WHERE LOWER(genre) = $${values.length}
      )
    `);
  }

  if (filters.mediaType) {
    values.push(filters.mediaType);
    conditions.push(`t.media_type = $${values.length}::title_media_type`);
  }

  if (filters.excludeHomepageHidden) {
    conditions.push("t.hide_from_homepage = FALSE");
  }

  if (filters.decade) {
    if (filters.decade === "pre-1950") {
      values.push(1950);
      conditions.push(`t.release_year < $${values.length}`);
    } else {
      values.push(filters.decade);
      values.push(filters.decade + 10);
      conditions.push(
        `t.release_year >= $${values.length - 1} AND t.release_year < $${values.length}`,
      );
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const limitClause =
    typeof filters.limit === "number" && filters.limit > 0
      ? `LIMIT ${Math.max(1, Math.floor(filters.limit))}`
      : "";
  const pageLimitClause =
    typeof normalizedPageSize === "number" ? `LIMIT ${normalizedPageSize}` : "";
  const offsetClause =
    typeof normalizedPageSize === "number"
      ? `OFFSET ${(normalizedPage - 1) * normalizedPageSize}`
      : "";
  const orderClause =
    filters.search && (!filters.sort || filters.sort === "title")
      ? "ORDER BY search_rank DESC, t.sort_title ASC, t.title ASC"
      : filters.sort === "rating-desc"
        ? "ORDER BY t.imdb_rating DESC NULLS LAST, t.sort_title ASC, t.title ASC"
        : filters.sort === "popular"
          ? "ORDER BY COUNT(DISTINCT i.id) DESC, MAX(i.last_rented_at) DESC NULLS LAST, t.imdb_rating DESC NULLS LAST, t.sort_title ASC"
          : filters.sort === "year-desc"
            ? "ORDER BY t.release_year DESC, t.sort_title ASC, t.title ASC"
            : filters.sort === "year-asc"
              ? "ORDER BY t.release_year ASC, t.sort_title ASC, t.title ASC"
              : "ORDER BY t.sort_title ASC, t.title ASC";

  return {
    text: `
      SELECT
        t.id,
        t.tmdb_id,
        t.imdb_id,
        t.imdb_rating,
        t.media_type,
        t.title,
        t.sort_title,
        t.overview,
        t.release_date,
        t.release_year,
        t.poster_path,
        t.genres,
        t.director,
        t.cast_members,
        t.featured,
        t.hide_from_homepage,
        COUNT(*) OVER()::INT AS total_count,
        ${searchRankSql}::numeric AS search_rank,
        COUNT(DISTINCT i.id) FILTER (WHERE ${filters.reviewedOnly ? "i.reviewed = TRUE" : "TRUE"})::INT AS total_copies,
        COUNT(DISTINCT i.id) FILTER (WHERE ${filters.reviewedOnly ? "i.reviewed = TRUE AND " : ""}i.availability = TRUE)::INT AS available_count
      FROM titles t
      LEFT JOIN inventory_item_titles itt ON itt.title_id = t.id
      LEFT JOIN inventory_items i ON i.id = itt.inventory_item_id
        ${filters.publicOnly ? `AND ${PUBLIC_FORMATS_SQL}` : ""}
      ${whereClause}
      GROUP BY t.id
      ${
        filters.reviewedOnly
          ? `HAVING COUNT(DISTINCT i.id) FILTER (WHERE i.reviewed = TRUE) > 0
      ${filters.available ? `AND COUNT(DISTINCT i.id) FILTER (WHERE i.reviewed = TRUE AND i.availability = TRUE) > 0` : ""}`
          : filters.available
            ? `HAVING COUNT(DISTINCT i.id) FILTER (WHERE i.availability = TRUE) > 0`
            : ""
      }
      ${orderClause}
      ${pageLimitClause || limitClause}
      ${offsetClause};
    `,
    values,
  };
}

async function getInventoryItemsForTitle(
  titleId: string,
  options?: { reviewedOnly?: boolean; publicOnly?: boolean },
) {
  const reviewedClause = options?.reviewedOnly ? "AND i.reviewed = TRUE" : "";
  const publicFormatClause = options?.publicOnly ? `AND ${PUBLIC_FORMATS_SQL}` : "";
  const result = await pool.query<InventoryItemRow>(
    `
      SELECT
        i.id,
        i.inventory_code,
        i.upc_ean,
        i.format::text,
        i.sealed,
        i.availability,
        i.reviewed,
        i.zone::text,
        (SELECT z.label FROM inventory_zones z WHERE z.code = i.zone) AS zone_label,
        i.section,
        i.row,
        i.notes,
        i.location_code,
        i.last_rented_at,
        i.day_price,
        i.weekend_price,
        i.late_class,
        i.updated_at,
        COALESCE(
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'id', t2.id,
              'title', t2.title,
              'sort_title', t2.sort_title,
              'media_type', t2.media_type::text,
              'release_date', t2.release_date,
              'release_year', t2.release_year,
              'poster_path', t2.poster_path,
              'season_start', itt2.season_start,
              'season_end', itt2.season_end,
              'episode_start', itt2.episode_start,
              'episode_end', itt2.episode_end
            )
            ORDER BY itt2.position ASC, t2.sort_title ASC
          ) FILTER (WHERE t2.id IS NOT NULL),
          '[]'::jsonb
        ) AS linked_titles
      FROM inventory_items i
      INNER JOIN inventory_item_titles itt ON itt.inventory_item_id = i.id
      LEFT JOIN inventory_item_titles itt2 ON itt2.inventory_item_id = i.id
      LEFT JOIN titles t2 ON t2.id = itt2.title_id
      WHERE itt.title_id = $1
      ${reviewedClause}
      ${publicFormatClause}
      GROUP BY i.id
      ORDER BY i.created_at ASC;
    `,
    [titleId],
  );

  return result.rows.map(toUiInventoryItem);
}

async function getCollectionDataForTitle(
  titleId: string,
  options?: { reviewedOnly?: boolean; publicOnly?: boolean },
): Promise<{
  collection?: TitleCollection;
  collectionTitles: LinkedTitle[];
}> {
  const reviewedCondition = options?.reviewedOnly
    ? `
      AND EXISTS (
        SELECT 1
        FROM inventory_item_titles visible_itt
        INNER JOIN inventory_items visible_i ON visible_i.id = visible_itt.inventory_item_id
        WHERE visible_itt.title_id = t.id
          AND visible_i.reviewed = TRUE
          ${options?.publicOnly ? `AND ${PUBLIC_FORMATS_SQL.replaceAll("i.", "visible_i.")}` : ""}
      )
    `
    : "";
  const result = await pool.query<CollectionTitleRow>(
    `
      SELECT
        c.id AS collection_id,
        c.name AS collection_name,
        c.poster_path AS collection_poster_path,
        t.id,
        t.title,
        t.sort_title,
        t.media_type,
        t.release_date,
        t.release_year
      FROM collection_titles current_ct
      INNER JOIN collections c ON c.id = current_ct.collection_id
      INNER JOIN collection_titles ct ON ct.collection_id = c.id
      INNER JOIN titles t ON t.id = ct.title_id
      WHERE current_ct.title_id = $1
      ${reviewedCondition}
      ORDER BY ct.position ASC, t.release_year ASC, t.sort_title ASC, t.title ASC;
    `,
    [titleId],
  );

  if (result.rowCount === 0) {
    return { collectionTitles: [] };
  }

  const [firstRow] = result.rows;

  return {
    collection: toUiCollection({
      id: firstRow.collection_id,
      tmdb_collection_id: 0,
      name: firstRow.collection_name,
      poster_path: firstRow.collection_poster_path,
    }),
    collectionTitles: result.rows.map((row) =>
      toUiLinkedTitle({
        id: row.id,
        title: row.title,
        sort_title: row.sort_title,
        media_type: row.media_type,
        release_date: row.release_date,
        release_year: row.release_year,
      }),
    ),
  };
}

export async function getInventoryItemById(id: string) {
  const result = await pool.query<InventoryItemRow>(
    `
      SELECT
        i.id,
        i.inventory_code,
        i.upc_ean,
        i.format::text,
        i.sealed,
        i.availability,
        i.reviewed,
        i.zone::text,
        (SELECT z.label FROM inventory_zones z WHERE z.code = i.zone) AS zone_label,
        i.section,
        i.row,
        i.notes,
        i.location_code,
        i.last_rented_at,
        i.day_price,
        i.weekend_price,
        i.late_class,
        i.updated_at,
        COALESCE(
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'id', t.id,
              'title', t.title,
              'sort_title', t.sort_title,
              'media_type', t.media_type::text,
              'release_date', t.release_date,
              'release_year', t.release_year,
              'poster_path', t.poster_path,
              'season_start', itt.season_start,
              'season_end', itt.season_end,
              'episode_start', itt.episode_start,
              'episode_end', itt.episode_end
            )
            ORDER BY itt.position ASC, t.sort_title ASC
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'::jsonb
        ) AS linked_titles,
        (
          SELECT JSONB_BUILD_OBJECT(
            'id', mr.id,
            'source', mr.source,
            'discogs_release_id', mr.discogs_release_id,
            'title', mr.title,
            'sort_title', mr.sort_title,
            'artist_credit', mr.artist_credit,
            'release_year', mr.release_year,
            'discogs_url', mr.discogs_url
          )
          FROM inventory_item_music_releases imr
          INNER JOIN music_releases mr ON mr.id = imr.music_release_id
          WHERE imr.inventory_item_id = i.id
        ) AS linked_music_release
      FROM inventory_items i
      LEFT JOIN inventory_item_titles itt ON itt.inventory_item_id = i.id
      LEFT JOIN titles t ON t.id = itt.title_id
      WHERE i.id = $1
      GROUP BY i.id
      LIMIT 1;
    `,
    [id],
  );

  const item = result.rows[0];

  if (!item) {
    throw createHttpError(404, "Inventory item not found");
  }

  return toUiInventoryItem(item);
}

export async function checkDatabaseHealth() {
  await pool.query("SELECT 1");
}

export async function getMovieFiltersFromDatabase(): Promise<{
  genres: string[];
  years: number[];
}> {
  const result = await pool.query<{ genres: string[] | null; release_year: number }>(
    `
      SELECT DISTINCT t.genres, t.release_year
      FROM titles t
      INNER JOIN inventory_item_titles itt ON itt.title_id = t.id
      INNER JOIN inventory_items i ON i.id = itt.inventory_item_id
      WHERE i.reviewed = TRUE
        AND ${PUBLIC_FORMATS_SQL}
    `,
  );

  const genres = Array.from(new Set(result.rows.flatMap((row) => row.genres ?? []))).sort();
  const years = Array.from(
    new Set(
      result.rows
        .map((row) => Number(row.release_year))
        .filter((year): year is number => typeof year === "number" && Number.isFinite(year)),
    ),
  ).sort((a, b) => b - a);

  return { genres, years };
}

export async function listMoviesPageFromDatabase(filters: MovieFilters) {
  const result = await pool.query<TitleRow>(buildListTitlesQuery(filters));
  const totalCount = result.rows[0]?.total_count ?? 0;

  return {
    items: result.rows,
    totalCount,
  };
}

export async function listMoviesFromDatabase(filters: MovieFilters) {
  const result = await listMoviesPageFromDatabase(filters);
  return result.items;
}

export async function getMovieFromDatabase(id: string) {
  const result = await pool.query<TitleRow>(
    `
      SELECT
        t.id,
        t.tmdb_id,
        t.imdb_id,
        t.imdb_rating,
        t.media_type,
        t.title,
        t.sort_title,
        t.overview,
        t.release_date,
        t.release_year,
        t.poster_path,
        t.genres,
        t.director,
        t.cast_members,
        t.featured,
        t.hide_from_homepage,
        COUNT(DISTINCT i.id)::INT AS total_copies,
        COUNT(DISTINCT i.id) FILTER (WHERE i.availability = TRUE)::INT AS available_count
      FROM titles t
      LEFT JOIN inventory_item_titles itt ON itt.title_id = t.id
      LEFT JOIN inventory_items i ON i.id = itt.inventory_item_id
      WHERE t.id = $1
      GROUP BY t.id;
    `,
    [id],
  );

  const title = result.rows[0];

  if (!title) {
    throw createHttpError(404, "Title not found");
  }

  const inventoryItems = await getInventoryItemsForTitle(id);
  const collectionData = await getCollectionDataForTitle(id);

  return {
    ...toUiTitle(title, inventoryItems),
    collection: collectionData.collection,
    collectionTitles: collectionData.collectionTitles,
  };
}

export async function listInventoryTitlesFromDatabase(query?: string, limit?: number) {
  const rows = await listMoviesFromDatabase({
    search: query?.trim() || undefined,
    available: false,
    limit,
  });

  return rows.map((row) => toUiTitle(row));
}

export async function listInventoryTitlesPageFromDatabase(query?: string, page = 1, pageSize = 50) {
  const pageResult = await listMoviesPageFromDatabase({
    search: query?.trim() || undefined,
    available: false,
    page,
    pageSize,
  });

  return {
    items: pageResult.items.map((row) => toUiTitle(row)),
    totalCount: pageResult.totalCount,
  };
}

export async function listBrowseMoviesFromDatabase(filters: {
  search?: string;
  genre?: string;
  decade?: string;
  available?: string;
  mediaType?: string;
  excludeHomepageHidden?: boolean;
  limit?: number;
  sort?: string;
}) {
  const rows = await listMoviesFromDatabase({
    search: filters.search?.trim() || undefined,
    genre: filters.genre && filters.genre !== "all" ? filters.genre : undefined,
    mediaType:
      filters.mediaType === "movie" || filters.mediaType === "series"
        ? filters.mediaType
        : undefined,
    excludeHomepageHidden: filters.excludeHomepageHidden === true,
    decade:
      filters.decade && filters.decade !== "all"
        ? filters.decade === "pre-1950"
          ? "pre-1950"
          : Number.parseInt(filters.decade, 10)
        : null,
    available: filters.available === "true",
    reviewedOnly: true,
    publicOnly: true,
    limit: filters.limit,
    sort:
      filters.sort === "rating-desc" ||
      filters.sort === "popular" ||
      filters.sort === "year-desc" ||
      filters.sort === "year-asc"
        ? filters.sort
        : "title",
  });

  return rows.map((row) => toUiTitle(row));
}

export async function listBrowseMoviesPageFromDatabase(filters: {
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
  const pageResult = await listMoviesPageFromDatabase({
    search: filters.search?.trim() || undefined,
    genre: filters.genre && filters.genre !== "all" ? filters.genre : undefined,
    mediaType:
      filters.mediaType === "movie" || filters.mediaType === "series"
        ? filters.mediaType
        : undefined,
    excludeHomepageHidden: filters.excludeHomepageHidden === true,
    decade:
      filters.decade && filters.decade !== "all"
        ? filters.decade === "pre-1950"
          ? "pre-1950"
          : Number.parseInt(filters.decade, 10)
        : null,
    available: filters.available === "true",
    reviewedOnly: true,
    publicOnly: true,
    limit: filters.limit,
    page: filters.page,
    pageSize: filters.pageSize,
    sort:
      filters.sort === "rating-desc" ||
      filters.sort === "popular" ||
      filters.sort === "year-desc" ||
      filters.sort === "year-asc"
        ? filters.sort
        : "title",
  });

  return {
    items: pageResult.items.map((row) => toUiTitle(row)),
    totalCount: pageResult.totalCount,
  };
}

export async function getTopGenresFromDatabase(
  limit = 3,
  options?: { excludeHomepageHidden?: boolean },
): Promise<string[]> {
  const result = await pool.query<{ genre: string }>(
    `
      SELECT genre
      FROM (
        SELECT genre, COUNT(*)::INT AS title_count
        FROM titles t
        INNER JOIN inventory_item_titles itt ON itt.title_id = t.id
        INNER JOIN inventory_items i ON i.id = itt.inventory_item_id
        CROSS JOIN LATERAL UNNEST(t.genres) AS genre
        WHERE genre <> ''
          AND i.reviewed = TRUE
          AND ${PUBLIC_FORMATS_SQL}
          ${options?.excludeHomepageHidden ? "AND t.hide_from_homepage = FALSE" : ""}
        GROUP BY genre
      ) ranked_genres
      ORDER BY title_count DESC, genre ASC
      LIMIT $1;
    `,
    [limit],
  );

  return result.rows.map((row) => row.genre);
}

export async function getHighestRatedMoviesFromDatabase(limit = 12) {
  return listBrowseMoviesFromDatabase({ limit, sort: "rating-desc" });
}

export async function getHighestRatedMoviesByMediaTypeFromDatabase(
  mediaType: "movie" | "series",
  limit = 12,
) {
  return listBrowseMoviesFromDatabase({
    limit,
    sort: "rating-desc",
    mediaType,
    excludeHomepageHidden: true,
  });
}

export async function getPopularMoviesFromDatabase(limit = 12) {
  return listBrowseMoviesFromDatabase({ limit, sort: "popular" });
}

export async function getPopularMoviesByMediaTypeFromDatabase(
  mediaType: "movie" | "series",
  limit = 12,
) {
  return listBrowseMoviesFromDatabase({
    limit,
    sort: "popular",
    mediaType,
    excludeHomepageHidden: true,
  });
}

export async function getMovieDetailFromDatabase(id: string) {
  return getMovieFromDatabase(id);
}

export async function getPublicMovieDetailFromDatabase(
  id: string,
): Promise<PublicMovieWithInventory> {
  const result = await pool.query<TitleRow>(
    `
      SELECT
        t.id,
        t.tmdb_id,
        t.imdb_id,
        t.imdb_rating,
        t.media_type,
        t.title,
        t.sort_title,
        t.overview,
        t.release_date,
        t.release_year,
        t.poster_path,
        t.genres,
        t.director,
        t.cast_members,
        t.featured,
        t.hide_from_homepage,
        COUNT(DISTINCT i.id) FILTER (WHERE i.reviewed = TRUE)::INT AS total_copies,
        COUNT(DISTINCT i.id) FILTER (WHERE i.reviewed = TRUE AND i.availability = TRUE)::INT AS available_count
      FROM titles t
      LEFT JOIN inventory_item_titles itt ON itt.title_id = t.id
      LEFT JOIN inventory_items i ON i.id = itt.inventory_item_id AND ${PUBLIC_FORMATS_SQL}
      WHERE t.id = $1
      GROUP BY t.id
      HAVING COUNT(DISTINCT i.id) FILTER (WHERE i.reviewed = TRUE) > 0;
    `,
    [id],
  );

  const title = result.rows[0];

  if (!title) {
    throw createHttpError(404, "Title not found");
  }

  const inventoryItems = await getInventoryItemsForTitle(id, {
    reviewedOnly: true,
    publicOnly: true,
  });
  const collectionData = await getCollectionDataForTitle(id, {
    reviewedOnly: true,
    publicOnly: true,
  });

  const publicInventoryItems = inventoryItems.filter(isPublicInventoryItem);

  return {
    ...toUiTitle(title, publicInventoryItems),
    inventoryItems: publicInventoryItems,
    collection: collectionData.collection,
    collectionTitles: collectionData.collectionTitles,
  };
}

export async function findMovieByTmdbId(tmdbId: string, mediaType?: string) {
  const parsedId = Number.parseInt(tmdbId, 10);

  if (Number.isNaN(parsedId)) {
    return null;
  }

  const result = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM titles
      WHERE tmdb_id = $1
        AND ($2::title_media_type IS NULL OR media_type = $2::title_media_type)
      LIMIT 1
    `,
    [parsedId, mediaType ?? null],
  );

  return result.rows[0]?.id ?? null;
}

export async function findDuplicateMovieForDraft(input: {
  tmdbId: string;
  mediaType: string;
  title: string;
  releaseYear?: number;
}) {
  const tmdbMatch = await findMovieByTmdbId(input.tmdbId, input.mediaType);

  if (tmdbMatch) {
    return tmdbMatch;
  }

  if (!input.title.trim()) {
    return null;
  }
  if (!input.releaseYear) return null;

  const result = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM titles
      WHERE LOWER(title) = LOWER($1)
        AND media_type = $2::title_media_type
        AND release_year = $3
      LIMIT 1
    `,
    [input.title.trim(), input.mediaType, input.releaseYear],
  );

  return result.rows[0]?.id ?? null;
}

export async function getFeaturedMoviesFromDatabase() {
  const result = await pool.query<TitleRow>(
    `
      SELECT
        t.id,
        t.tmdb_id,
        t.imdb_id,
        t.imdb_rating,
        t.media_type,
        t.title,
        t.sort_title,
        t.overview,
        t.release_date,
        t.release_year,
        t.poster_path,
        t.genres,
        t.director,
        t.cast_members,
        t.featured,
        t.hide_from_homepage,
        COUNT(DISTINCT i.id) FILTER (WHERE i.reviewed = TRUE)::INT AS total_copies,
        COUNT(DISTINCT i.id) FILTER (WHERE i.reviewed = TRUE AND i.availability = TRUE)::INT AS available_count
      FROM titles t
      LEFT JOIN inventory_item_titles itt ON itt.title_id = t.id
      LEFT JOIN inventory_items i ON i.id = itt.inventory_item_id AND ${PUBLIC_FORMATS_SQL}
      WHERE t.featured = TRUE
        AND t.hide_from_homepage = FALSE
      GROUP BY t.id
      HAVING COUNT(DISTINCT i.id) FILTER (WHERE i.reviewed = TRUE) > 0
      ORDER BY t.imdb_rating DESC NULLS LAST, t.sort_title ASC, t.title ASC;
    `,
  );

  return result.rows.map((row) => toUiTitle(row));
}

export async function getRecentlyReturnedMoviesFromDatabase(limit = 6) {
  const result = await pool.query<TitleRow>(
    `
      SELECT
        t.id,
        t.tmdb_id,
        t.imdb_id,
        t.imdb_rating,
        t.media_type,
        t.title,
        t.sort_title,
        t.overview,
        t.release_date,
        t.release_year,
        t.poster_path,
        t.genres,
        t.director,
        t.cast_members,
        t.featured,
        t.hide_from_homepage,
        COUNT(DISTINCT i.id) FILTER (WHERE i.reviewed = TRUE)::INT AS total_copies,
        COUNT(DISTINCT i.id) FILTER (WHERE i.reviewed = TRUE AND i.availability = TRUE)::INT AS available_count
      FROM titles t
      INNER JOIN inventory_item_titles itt ON itt.title_id = t.id
      INNER JOIN inventory_items i ON i.id = itt.inventory_item_id
      WHERE i.last_rented_at IS NOT NULL
        AND ${PUBLIC_FORMATS_SQL}
        AND i.reviewed = TRUE
        AND t.hide_from_homepage = FALSE
      GROUP BY t.id
      ORDER BY MAX(i.last_rented_at) DESC, t.sort_title ASC
      LIMIT $1;
    `,
    [limit],
  );

  return result.rows.map((row) => toUiTitle(row));
}

export async function createMovieInDatabase(input: {
  tmdbId: string;
  imdbId?: string;
  imdbRating?: number | null;
  mediaType: string;
  title: string;
  sortTitle: string;
  releaseYear: unknown;
  overview: string;
  releaseDate?: string;
  posterPath: string | null;
  genres: string[];
  director: string;
  cast: Array<{ name: string; character: string }>;
  collection?: TmdbCollectionDraft | null;
}) {
  const normalizedTitle = input.title.trim();
  const normalizedSortTitle = input.sortTitle.trim();
  let releaseYear: number | null;
  try {
    releaseYear = normalizeReleaseYearInput(input.releaseYear);
  } catch (error) {
    if (error instanceof ReleaseYearInputError) throw createHttpError(400, error.message);
    throw error;
  }
  if (!normalizedTitle) throw createHttpError(400, 'Field "title" is required');
  if (!normalizedSortTitle) throw createHttpError(400, 'Field "sort_title" is required');
  if (releaseYear === null) throw createHttpError(400, 'Field "release_year" is required');
  const releaseDate = input.releaseDate?.trim() ?? "";
  if (releaseDate && Number(releaseDate.slice(0, 4)) !== releaseYear) {
    throw createHttpError(400, "Release date must match the release year.");
  }

  const duplicateId = await findDuplicateMovieForDraft({
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    title: normalizedTitle,
    releaseYear,
  });

  if (duplicateId) {
    throw createHttpError(409, "Title already exists");
  }

  const normalizedImdbId =
    typeof input.imdbId === "string" && /^tt\d+$/i.test(input.imdbId.trim())
      ? input.imdbId.trim()
      : "";
  const omdbMetadata =
    normalizedImdbId && input.imdbRating === undefined
      ? await fetchOmdbTitleMetadataByImdbId(normalizedImdbId).catch(() => null)
      : null;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const titleId = await upsertTitleFromDraft(client, {
      tmdbId: input.tmdbId,
      imdbId: omdbMetadata?.imdbId ?? normalizedImdbId,
      imdbRating:
        input.imdbRating === undefined ? (omdbMetadata?.imdbRating ?? null) : input.imdbRating,
      mediaType: normalizeMediaType(input.mediaType),
      title: normalizedTitle,
      sortTitle: normalizedSortTitle,
      releaseYear,
      overview: input.overview.trim(),
      releaseDate,
      posterPath: input.posterPath,
      genres: input.genres,
      director: input.director.trim() || "",
      cast: input.cast,
    });

    if (input.collection && normalizeMediaType(input.mediaType) === "movie") {
      await upsertCollectionForTitle(client, input.collection);
    }

    await client.query("COMMIT");
    return titleId;
  } catch (error) {
    await client.query("ROLLBACK");

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "23505" || error.code === "23P01")
    ) {
      const duplicateId = await findDuplicateMovieForDraft({
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        title: normalizedTitle,
        releaseYear,
      });

      if (duplicateId) {
        return duplicateId;
      }

      throw createHttpError(409, "Title already exists");
    }

    throw error;
  } finally {
    client.release();
  }
}

async function upsertTitleFromDraft(
  client: { query: typeof pool.query },
  input: {
    tmdbId: string;
    imdbId?: string;
    imdbRating?: number | null;
    mediaType: "movie" | "series";
    title: string;
    sortTitle: string;
    releaseYear: number;
    overview: string;
    releaseDate: string;
    posterPath: string | null;
    genres: string[];
    director: string;
    cast: Array<{ name: string; character: string }>;
  },
) {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO titles (
        tmdb_id,
        imdb_id,
        imdb_rating,
        media_type,
        title,
        sort_title,
        overview,
        release_year,
        release_date,
        poster_path,
        genres,
        director,
        cast_members,
        featured
      )
      VALUES ($1, $2, $3, $4::title_media_type, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
      ON CONFLICT (tmdb_id, media_type)
      DO UPDATE SET
        imdb_id = COALESCE(EXCLUDED.imdb_id, titles.imdb_id),
        imdb_rating = COALESCE(EXCLUDED.imdb_rating, titles.imdb_rating),
        title = EXCLUDED.title,
        sort_title = CASE
          WHEN EXCLUDED.sort_title <> '' THEN EXCLUDED.sort_title
          WHEN titles.sort_title = '' THEN EXCLUDED.sort_title
          ELSE titles.sort_title
        END,
        overview = CASE
          WHEN EXCLUDED.overview <> '' THEN EXCLUDED.overview
          ELSE titles.overview
        END,
        release_year = EXCLUDED.release_year,
        release_date = CASE
          WHEN EXCLUDED.release_year <> titles.release_year THEN EXCLUDED.release_date
          ELSE COALESCE(EXCLUDED.release_date, titles.release_date)
        END,
        poster_path = COALESCE(EXCLUDED.poster_path, titles.poster_path),
        genres = CASE
          WHEN CARDINALITY(EXCLUDED.genres) > 0 THEN EXCLUDED.genres
          ELSE titles.genres
        END,
        director = CASE
          WHEN EXCLUDED.director <> '' THEN EXCLUDED.director
          ELSE titles.director
        END,
        cast_members = CASE
          WHEN EXCLUDED.cast_members <> '[]'::jsonb THEN EXCLUDED.cast_members
          ELSE titles.cast_members
        END,
        updated_at = NOW()
      RETURNING id;
    `,
    [
      Number.parseInt(input.tmdbId, 10),
      input.imdbId?.trim() || null,
      input.imdbRating ?? null,
      input.mediaType,
      input.title.trim(),
      input.sortTitle.trim(),
      input.overview.trim(),
      input.releaseYear,
      input.releaseDate || null,
      input.posterPath,
      input.genres,
      input.director.trim(),
      JSON.stringify(input.cast),
      false,
    ],
  );

  return result.rows[0].id;
}

async function upsertCollectionForTitle(
  client: { query: typeof pool.query },
  collection: TmdbCollectionDraft,
) {
  const anchorTitle = collection.titles[0];
  const collectionResult = await client.query<CollectionRow>(
    `
      INSERT INTO collections (
        tmdb_collection_id,
        name,
        sort_name,
        anchor_title,
        anchor_sort_title,
        anchor_release_date,
        overview,
        poster_path
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (tmdb_collection_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        sort_name = EXCLUDED.sort_name,
        anchor_title = EXCLUDED.anchor_title,
        anchor_sort_title = EXCLUDED.anchor_sort_title,
        anchor_release_date = COALESCE(EXCLUDED.anchor_release_date, collections.anchor_release_date),
        overview = EXCLUDED.overview,
        poster_path = COALESCE(EXCLUDED.poster_path, collections.poster_path),
        updated_at = NOW()
      RETURNING id, tmdb_collection_id, name, poster_path;
    `,
    [
      Number.parseInt(collection.tmdbId, 10),
      collection.name,
      getSuggestedSortTitle(collection.name),
      anchorTitle?.title ?? collection.name,
      anchorTitle
        ? getSuggestedSortTitle(anchorTitle.title)
        : getSuggestedSortTitle(collection.name),
      anchorTitle?.releaseDate || null,
      collection.overview,
      collection.posterPath,
    ],
  );

  const collectionId = collectionResult.rows[0].id;
  const tmdbIds = collection.titles
    .map((title) => Number.parseInt(title.tmdbId, 10))
    .filter((tmdbId) => !Number.isNaN(tmdbId));

  if (tmdbIds.length === 0) {
    return;
  }

  const existingTitles = await client.query<{ id: string; tmdb_id: number }>(
    `
      SELECT id, tmdb_id
      FROM titles
      WHERE media_type = 'movie'
        AND tmdb_id = ANY($1::int[]);
    `,
    [tmdbIds],
  );

  const existingByTmdbId = new Map(existingTitles.rows.map((row) => [row.tmdb_id, row.id]));
  const linkedTitleIds: string[] = [];

  for (const [index, title] of collection.titles.entries()) {
    const titleId = existingByTmdbId.get(Number.parseInt(title.tmdbId, 10));

    if (!titleId) {
      continue;
    }

    linkedTitleIds.push(titleId);

    await client.query(
      `
        INSERT INTO collection_titles (collection_id, title_id, position)
        VALUES ($1, $2, $3)
        ON CONFLICT (collection_id, title_id)
        DO UPDATE SET position = EXCLUDED.position;
      `,
      [collectionId, titleId, index + 1],
    );
  }

  if (linkedTitleIds.length > 0) {
    await client.query(
      `
        DELETE FROM collection_titles
        WHERE collection_id = $1
          AND title_id <> ALL($2::uuid[]);
      `,
      [collectionId, linkedTitleIds],
    );
  }
}

export async function updateMovieInDatabase(id: string, body: Record<string, unknown>) {
  const title = body.title === undefined ? null : requireNonEmptyString(body.title, "title");
  const sortTitle =
    body.sort_title === undefined ? null : requireNonEmptyString(body.sort_title, "sort_title");
  const overview = body.overview === undefined ? null : (optionalString(body.overview) ?? "");
  const releaseDate = body.release_date === undefined ? null : optionalString(body.release_date);
  let releaseYear: number | null = null;
  if (body.release_year !== undefined) {
    try {
      releaseYear = normalizeReleaseYearInput(body.release_year);
    } catch (error) {
      if (error instanceof ReleaseYearInputError) throw createHttpError(400, error.message);
      throw error;
    }
    if (releaseYear === null) throw createHttpError(400, 'Field "release_year" is required');
  }
  if (releaseDate && releaseYear !== null && Number(releaseDate.slice(0, 4)) !== releaseYear) {
    throw createHttpError(400, "Release date must match the release year.");
  }
  const mediaType = body.media_type === undefined ? null : normalizeMediaType(body.media_type);
  const featured =
    body.featured === undefined
      ? null
      : typeof body.featured === "boolean"
        ? body.featured
        : body.featured === "true"
          ? true
          : body.featured === "false"
            ? false
            : (() => {
                throw createHttpError(400, 'Field "featured" is invalid');
              })();
  const hideFromHomepage =
    body.hide_from_homepage === undefined
      ? null
      : typeof body.hide_from_homepage === "boolean"
        ? body.hide_from_homepage
        : body.hide_from_homepage === "true"
          ? true
          : body.hide_from_homepage === "false"
            ? false
            : (() => {
                throw createHttpError(400, 'Field "hide_from_homepage" is invalid');
              })();
  const director = body.director === undefined ? null : (optionalString(body.director) ?? "");
  const posterPath =
    body.poster_path === undefined
      ? null
      : typeof body.poster_path === "string" && body.poster_path.trim() !== ""
        ? body.poster_path.trim()
        : "";
  const genres =
    body.genres === undefined
      ? null
      : Array.isArray(body.genres)
        ? body.genres.flatMap((value) =>
            typeof value === "string" && value.trim() ? [value.trim()] : [],
          )
        : typeof body.genres === "string"
          ? body.genres
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : (() => {
              throw createHttpError(400, 'Field "genres" is invalid');
            })();
  const castMembers =
    body.cast === undefined
      ? null
      : Array.isArray(body.cast)
        ? body.cast.flatMap((value) =>
            typeof value === "string" && value.trim() ? [value.trim()] : [],
          )
        : typeof body.cast === "string"
          ? body.cast
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : (() => {
              throw createHttpError(400, 'Field "cast" is invalid');
            })();

  if (
    title === null &&
    sortTitle === null &&
    overview === null &&
    releaseDate === null &&
    releaseYear === null &&
    mediaType === null &&
    featured === null &&
    hideFromHomepage === null &&
    director === null &&
    posterPath === null &&
    genres === null &&
    castMembers === null
  ) {
    throw createHttpError(400, "Request body must include at least one updatable field");
  }

  const result = await pool.query<{ id: string }>(
    `
      UPDATE titles
      SET
        title = COALESCE($2, title),
        sort_title = COALESCE($3, sort_title),
        overview = COALESCE($4, overview),
        release_year = COALESCE($13, release_year),
        release_date = CASE
          WHEN $13 IS NOT NULL AND $13 <> release_year THEN NULL
          ELSE COALESCE($5::date, release_date)
        END,
        media_type = COALESCE($6::title_media_type, media_type),
        featured = COALESCE($7, featured),
        hide_from_homepage = COALESCE($8, hide_from_homepage),
        director = COALESCE($9, director),
        poster_path = COALESCE($10, poster_path),
        genres = COALESCE($11::text[], genres),
        cast_members = COALESCE($12::jsonb, cast_members),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id;
    `,
    [
      id,
      title,
      sortTitle,
      overview,
      releaseDate,
      mediaType,
      featured,
      hideFromHomepage,
      director,
      posterPath,
      genres,
      castMembers ? JSON.stringify(castMembers.map((name) => ({ name, character: "" }))) : null,
      releaseYear,
    ],
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, "Title not found");
  }

  return { id };
}

export async function deleteMovieFromDatabase(id: string) {
  const linkedInventory = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM inventory_item_titles
      WHERE title_id = $1;
    `,
    [id],
  );

  if (Number.parseInt(linkedInventory.rows[0]?.count ?? "0", 10) > 0) {
    throw createHttpError(409, "Cannot delete a title that still has discs linked");
  }

  const result = await pool.query(
    `
      DELETE FROM titles
      WHERE id = $1
      RETURNING id;
    `,
    [id],
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, "Title not found");
  }

  return { id };
}

export async function bulkUpdateMoviesInDatabase(body: Record<string, unknown>) {
  const action = optionalString(body.action);
  const titleIds = Array.isArray(body.title_ids)
    ? body.title_ids.filter(
        (value): value is string => typeof value === "string" && value.trim() !== "",
      )
    : typeof body.title_ids === "string"
      ? body.title_ids
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

  if (!action) {
    throw createHttpError(400, 'Field "action" is required');
  }

  if (titleIds.length === 0) {
    throw createHttpError(400, 'Field "title_ids" must include at least one title');
  }

  if (action === "feature" || action === "unfeature") {
    const result = await pool.query(
      `
        UPDATE titles
        SET featured = $2, updated_at = NOW()
        WHERE id = ANY($1::uuid[]);
      `,
      [titleIds, action === "feature"],
    );

    return { updatedCount: result.rowCount ?? 0 };
  }

  if (action === "delete") {
    const linked = await pool.query<{ id: string }>(
      `
        SELECT DISTINCT title_id AS id
        FROM inventory_item_titles
        WHERE title_id = ANY($1::uuid[]);
      `,
      [titleIds],
    );

    if (linked.rowCount && linked.rowCount > 0) {
      throw createHttpError(409, "One or more selected titles still have discs linked");
    }

    const result = await pool.query(
      `
        DELETE FROM titles
        WHERE id = ANY($1::uuid[]);
      `,
      [titleIds],
    );

    return { updatedCount: result.rowCount ?? 0 };
  }

  throw createHttpError(400, 'Field "action" is invalid');
}

function requireNonEmptyString(value: unknown, fieldName: string) {
  const normalizedValue = optionalString(value);

  if (!normalizedValue) {
    throw createHttpError(400, `Field "${fieldName}" is required`);
  }

  return normalizedValue;
}

export async function bulkUpdateMovieInventoryInDatabase(
  titleId: string,
  body: Record<string, unknown>,
) {
  const updates = body.updates;

  if (!Array.isArray(updates) || updates.length === 0) {
    throw createHttpError(400, 'Field "updates" must be a non-empty array');
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const titleExists = await client.query("SELECT id FROM titles WHERE id = $1", [titleId]);
    if (titleExists.rowCount === 0) {
      throw createHttpError(404, "Title not found");
    }

    for (const update of updates) {
      if (!update || typeof update !== "object" || Array.isArray(update)) {
        throw createHttpError(400, "Each update must be a JSON object");
      }

      if (typeof update.id !== "string" || update.id.trim() === "") {
        throw createHttpError(400, 'Each update must include a non-empty string "id"');
      }

      const result = await client.query(
        `
          UPDATE inventory_items i
          SET availability = $2,
              updated_at = NOW()
          FROM inventory_item_titles itt
          WHERE i.id = $1
            AND itt.inventory_item_id = i.id
            AND itt.title_id = $3
          RETURNING i.id;
        `,
        [update.id.trim(), normalizeAvailability(update.availability), titleId],
      );

      if (result.rowCount === 0) {
        throw createHttpError(
          404,
          "One or more inventory items were not found for the specified title",
        );
      }
    }

    await client.query("COMMIT");
    return { success: true, updated_count: updates.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function bulkUpdateInventoryItemsInDatabase(body: Record<string, unknown>) {
  const action = optionalString(body.action);
  const applyAvailability = body.apply_availability === true;
  const applyReviewed = body.apply_reviewed === true;
  const applyZone = body.apply_zone === true;
  const applySection = body.apply_section === true;
  const applyRow = body.apply_row === true;
  const zone = applyZone ? normalizeZone(body.zone) : null;
  const section = applySection ? normalizeLocationPart(body.section, "section") : null;
  const row = applyRow ? normalizeRowPart(body.row) : null;
  if (zone !== null) {
    await assertInventoryZoneIsAssignable(zone);
  }
  const inventoryIds = Array.isArray(body.inventory_ids)
    ? body.inventory_ids.filter(
        (value): value is string => typeof value === "string" && value.trim() !== "",
      )
    : typeof body.inventory_ids === "string"
      ? body.inventory_ids
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  const uniqueInventoryIds = Array.from(new Set(inventoryIds));

  if (uniqueInventoryIds.length === 0) {
    throw createHttpError(400, 'Field "inventory_ids" must include at least one disc');
  }

  if (action === "delete") {
    const result = await pool.query(
      `
        DELETE FROM inventory_items
        WHERE id = ANY($1::uuid[]);
      `,
      [uniqueInventoryIds],
    );

    return { updatedCount: result.rowCount ?? 0 };
  }

  if (action === "edit") {
    const availability =
      !applyAvailability ||
      body.availability === undefined ||
      body.availability === null ||
      optionalString(body.availability) === null
        ? null
        : normalizeAvailability(body.availability);
    const reviewed =
      !applyReviewed ||
      body.reviewed === undefined ||
      body.reviewed === null ||
      optionalString(body.reviewed) === null
        ? null
        : normalizeAvailability(body.reviewed);

    if (!applyAvailability && !applyReviewed && !applyZone && !applySection && !applyRow) {
      throw createHttpError(400, "Select at least one field to update");
    }

    if (applyAvailability && availability === null) {
      throw createHttpError(400, 'Field "availability" is required');
    }

    if (applyReviewed && reviewed === null) {
      throw createHttpError(400, 'Field "reviewed" is required');
    }

    const result = await pool.query(
      `
        UPDATE inventory_items
        SET
          availability = COALESCE($2, availability),
          reviewed = COALESCE($3, reviewed),
          zone = COALESCE($4, zone),
          section = COALESCE($5, section),
          row = COALESCE($6, row),
          location_code = CONCAT(COALESCE($4, zone), '/', COALESCE($5, section), COALESCE($6, row)),
          updated_at = NOW()
        WHERE id = ANY($1::uuid[]);
      `,
      [
        uniqueInventoryIds,
        applyAvailability ? availability : null,
        applyReviewed ? reviewed : null,
        zone,
        section,
        row,
      ],
    );

    return { updatedCount: result.rowCount ?? 0 };
  }

  throw createHttpError(400, 'Field "action" is invalid');
}

export {
  getAlphabeticalStockSectionsFromDatabase,
  getStockViewOptionsFromDatabase,
  listStockDiscsFromDatabase,
} from "@/lib/server/inventory/stock-queries";
