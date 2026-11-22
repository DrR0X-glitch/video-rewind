import "server-only";

import { ZONE_OPTIONS, formatZoneLabel } from "@/lib/constants";
import { pool } from "@/lib/server/db";
import { fetchOmdbTitleMetadataByImdbId } from "@/lib/server/omdb";
import {
  createHttpError,
  formatDateOnly,
  formatTimestamp,
  formatPosterUrl,
  normalizeAvailability,
  normalizeCast,
  normalizeFormat,
  normalizeLateClass,
  normalizeMediaType,
  normalizeMoney,
  normalizeSealed,
  optionalString,
} from "@/lib/server/http";
import type {
  InventoryItem,
  LinkedTitle,
  MovieWithInventory,
  StockViewDisc,
  StockViewPage,
  StockViewSection,
  TitleCollection,
} from "@/lib/types";
import type { TmdbCollectionDraft } from "@/lib/server/tmdb";

type MovieFilters = {
  search?: string;
  genre?: string;
  decade?: number | "pre-1950" | null;
  available?: boolean;
  reviewedOnly?: boolean;
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

const STOCK_TITLE_SEARCH_VECTOR_SQL = `
  (
    setweight(to_tsvector('simple', COALESCE(tq.title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(tq.sort_title, '')), 'A')
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
  format: string;
  sealed: boolean;
  availability: boolean;
  reviewed: boolean;
  zone: string;
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
    season_start?: number | null;
    season_end?: number | null;
    episode_start?: number | null;
    episode_end?: number | null;
  }>;
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
};

type StockDiscRow = InventoryItemRow & {
  is_primary: boolean;
  sort_label: string;
  sort_anchor: string;
  sort_sequence: number;
  collection_name: string | null;
};

function getSuggestedSortTitle(title: string) {
  return title.replace(/^(a|an|the)\s+/i, "").trim() || title.trim();
}

function buildLocationCode(zone: string, section: string, row: string) {
  return `${zone}/${section}${row}`;
}

function getFormatPrioritySql(column: string) {
  return `(CASE ${column}::text WHEN '4k-uhd' THEN 0 WHEN 'blu-ray' THEN 1 ELSE 2 END)`;
}

async function allocateLowestInventoryCode(client: { query: typeof pool.query }) {
  const result = await client.query<{ inventory_code: string }>(
    `
      SELECT LPAD(candidate.code::text, 6, '0') AS inventory_code
      FROM generate_series(1, 999999) AS candidate(code)
      LEFT JOIN inventory_items i
        ON i.inventory_code = LPAD(candidate.code::text, 6, '0')
      WHERE i.inventory_code IS NULL
      ORDER BY candidate.code ASC
      LIMIT 1;
    `,
  );

  const inventoryCode = result.rows[0]?.inventory_code;

  if (!inventoryCode) {
    throw createHttpError(409, "No disc codes are available");
  }

  return inventoryCode;
}

function getPosterColor(title: string) {
  const palette = ["#3454b4", "#7b5d43", "#8d2f2b", "#223724", "#d0893d", "#5a6778"];
  const total = Array.from(title).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[total % palette.length];
}

function normalizeZone(value: unknown) {
  const raw = optionalString(value) ?? "";
  const normalized =
    raw.toLowerCase() === "shed"
      ? "S"
      : raw.toLowerCase() === "display"
        ? "D"
        : raw.toLowerCase() === "wall"
          ? "W"
          : raw.toUpperCase();

  if (!normalized) {
    throw createHttpError(400, 'Field "zone" is required');
  }

  if (!ZONE_OPTIONS.includes(normalized as (typeof ZONE_OPTIONS)[number])) {
    throw createHttpError(400, 'Field "zone" is invalid');
  }

  return normalized;
}

function normalizeLocationPart(value: unknown, fieldName: "section" | "row") {
  const normalized = optionalString(value)?.toUpperCase() ?? "";

  if (!normalized) {
    throw createHttpError(400, `Field "${fieldName}" is required`);
  }

  if (normalized.length < 1 || normalized.length > 2) {
    throw createHttpError(400, `Field "${fieldName}" must be 1 or 2 characters`);
  }

  return normalized;
}

function normalizeRowPart(value: unknown) {
  const normalized = optionalString(value)?.toUpperCase() ?? "";

  if (!normalized) {
    return "00";
  }

  if (normalized.length < 1 || normalized.length > 2) {
    throw createHttpError(400, 'Field "row" must be 1 or 2 characters when provided');
  }

  return normalized;
}

function toUiLinkedTitle(title: {
  id: string;
  title: string;
  sort_title?: string | null;
  media_type: "movie" | "series";
  release_date: string | Date | null;
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
    format:
      item.format.toLowerCase() === "blu-ray"
        ? "blu-ray"
        : item.format.toLowerCase() === "4k-uhd"
          ? "4k-uhd"
          : "dvd",
    sealed: Boolean(item.sealed),
    availability: item.availability,
    reviewed: item.reviewed,
    zone: item.zone,
    section: item.section,
    row: item.row,
    locationCode: item.location_code,
    linkedTitles: Array.isArray(item.linked_titles) ? item.linked_titles.map(toUiLinkedTitle) : [],
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
      conditions.push(`t.release_date < MAKE_DATE($${values.length}, 1, 1)`);
    } else {
      values.push(filters.decade);
      values.push(filters.decade + 10);
      conditions.push(
        `t.release_date >= MAKE_DATE($${values.length - 1}, 1, 1) AND t.release_date < MAKE_DATE($${values.length}, 1, 1)`,
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
            ? "ORDER BY t.release_date DESC NULLS LAST, t.sort_title ASC, t.title ASC"
            : filters.sort === "year-asc"
              ? "ORDER BY t.release_date ASC NULLS LAST, t.sort_title ASC, t.title ASC"
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

async function getInventoryItemsForTitle(titleId: string, options?: { reviewedOnly?: boolean }) {
  const reviewedClause = options?.reviewedOnly ? "AND i.reviewed = TRUE" : "";
  const result = await pool.query<InventoryItemRow>(
    `
      SELECT
        i.id,
        i.inventory_code,
        i.format::text,
        i.sealed,
        i.availability,
        i.reviewed,
        i.zone::text,
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
      GROUP BY i.id
      ORDER BY i.created_at ASC;
    `,
    [titleId],
  );

  return result.rows.map(toUiInventoryItem);
}

function toUiStockDisc(item: StockDiscRow): StockViewDisc {
  return {
    ...toUiInventoryItem(item),
    collectionName: item.collection_name ?? undefined,
    isPrimary: Boolean(item.is_primary),
    sortLabel: item.sort_label,
    sortAnchor: item.sort_anchor,
    sortSequence: item.sort_sequence,
  };
}

async function getCollectionDataForTitle(
  titleId: string,
  options?: { reviewedOnly?: boolean },
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
        t.release_date
      FROM collection_titles current_ct
      INNER JOIN collections c ON c.id = current_ct.collection_id
      INNER JOIN collection_titles ct ON ct.collection_id = c.id
      INNER JOIN titles t ON t.id = ct.title_id
      WHERE current_ct.title_id = $1
      ${reviewedCondition}
      ORDER BY ct.position ASC, t.release_date ASC NULLS LAST, t.sort_title ASC, t.title ASC;
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
        i.format::text,
        i.sealed,
        i.availability,
        i.reviewed,
        i.zone::text,
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
              'season_start', itt.season_start,
              'season_end', itt.season_end,
              'episode_start', itt.episode_start,
              'episode_end', itt.episode_end
            )
            ORDER BY itt.position ASC, t.sort_title ASC
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'::jsonb
        ) AS linked_titles
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

async function ensureTitlesExist(titleIds: string[]) {
  if (titleIds.length === 0) {
    throw createHttpError(400, 'Field "title_ids" must include at least one title');
  }

  const result = await pool.query<{ id: string }>(
    `SELECT id FROM titles WHERE id = ANY($1::uuid[])`,
    [titleIds],
  );

  if (result.rowCount !== titleIds.length) {
    throw createHttpError(404, "One or more titles were not found");
  }
}

function normalizeOptionalSeasonNumber(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  throw createHttpError(400, `Field "${fieldName}" is invalid`);
}

function validateSeasonRange(title: {
  titleId: string;
  seasonStart: number | null;
  seasonEnd: number | null;
  episodeStart: number | null;
  episodeEnd: number | null;
}) {
  if (title.seasonEnd !== null && title.seasonStart === null) {
    throw createHttpError(400, 'Field "season_end" requires "season_start"');
  }

  if (
    title.seasonStart !== null &&
    title.seasonEnd !== null &&
    title.seasonEnd < title.seasonStart
  ) {
    throw createHttpError(
      400,
      'Field "season_end" must be greater than or equal to "season_start"',
    );
  }

  if (title.episodeEnd !== null && title.episodeStart === null) {
    throw createHttpError(400, 'Field "episode_end" requires "episode_start"');
  }

  if (
    title.episodeStart !== null &&
    title.episodeEnd !== null &&
    title.episodeEnd < title.episodeStart
  ) {
    throw createHttpError(
      400,
      'Field "episode_end" must be greater than or equal to "episode_start"',
    );
  }

  if (title.episodeStart !== null && title.seasonStart === null) {
    throw createHttpError(400, 'Field "episode_start" requires "season_start"');
  }

  const normalizedSeasonEnd = title.seasonEnd ?? title.seasonStart;

  if (
    title.episodeStart !== null &&
    title.seasonStart !== null &&
    normalizedSeasonEnd !== null &&
    normalizedSeasonEnd !== title.seasonStart
  ) {
    throw createHttpError(400, "Episode ranges require a single season");
  }

  return {
    titleId: title.titleId,
    seasonStart: title.seasonStart,
    seasonEnd: normalizedSeasonEnd,
    episodeStart: title.episodeStart,
    episodeEnd: title.episodeEnd ?? title.episodeStart,
  };
}

function parseInventoryTitleLinks(body: Record<string, unknown>) {
  if (Array.isArray(body.title_links)) {
    const links = body.title_links.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }

      const titleId = optionalString(value.title_id);

      if (!titleId) {
        return [];
      }

      return [
        validateSeasonRange({
          titleId,
          seasonStart: normalizeOptionalSeasonNumber(value.season_start, "season_start"),
          seasonEnd: normalizeOptionalSeasonNumber(value.season_end, "season_end"),
          episodeStart: normalizeOptionalSeasonNumber(value.episode_start, "episode_start"),
          episodeEnd: normalizeOptionalSeasonNumber(value.episode_end, "episode_end"),
        }),
      ];
    });

    if (links.length > 0) {
      return links;
    }
  }

  const titleIds = Array.isArray(body.title_ids)
    ? body.title_ids.filter(
        (value): value is string => typeof value === "string" && value.trim() !== "",
      )
    : typeof body.title_ids === "string"
      ? body.title_ids
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : typeof body.movie_id === "string" && body.movie_id.trim()
        ? [body.movie_id.trim()]
        : [];

  const seasonStarts = Array.isArray(body.season_starts) ? body.season_starts : [];
  const seasonEnds = Array.isArray(body.season_ends) ? body.season_ends : [];
  const episodeStarts = Array.isArray(body.episode_starts) ? body.episode_starts : [];
  const episodeEnds = Array.isArray(body.episode_ends) ? body.episode_ends : [];

  return titleIds.map((titleId, index) =>
    validateSeasonRange({
      titleId,
      seasonStart: normalizeOptionalSeasonNumber(seasonStarts[index], "season_start"),
      seasonEnd: normalizeOptionalSeasonNumber(seasonEnds[index], "season_end"),
      episodeStart: normalizeOptionalSeasonNumber(episodeStarts[index], "episode_start"),
      episodeEnd: normalizeOptionalSeasonNumber(episodeEnds[index], "episode_end"),
    }),
  );
}

export async function checkDatabaseHealth() {
  await pool.query("SELECT 1");
}

export async function getMovieFiltersFromDatabase(): Promise<{
  genres: string[];
  years: number[];
}> {
  const result = await pool.query<{ genres: string[] | null; release_date: string | Date | null }>(
    `
      SELECT DISTINCT t.genres, t.release_date
      FROM titles t
      INNER JOIN inventory_item_titles itt ON itt.title_id = t.id
      INNER JOIN inventory_items i ON i.id = itt.inventory_item_id
      WHERE i.reviewed = TRUE
    `,
  );

  const genres = Array.from(new Set(result.rows.flatMap((row) => row.genres ?? []))).sort();
  const years = Array.from(
    new Set(
      result.rows
        .map((row) => (row.release_date ? new Date(row.release_date).getFullYear() : null))
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

export async function getPublicMovieDetailFromDatabase(id: string) {
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
      LEFT JOIN inventory_items i ON i.id = itt.inventory_item_id
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

  const inventoryItems = await getInventoryItemsForTitle(id, { reviewedOnly: true });
  const collectionData = await getCollectionDataForTitle(id, { reviewedOnly: true });

  return {
    ...toUiTitle(title, inventoryItems),
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
  releaseDate: string;
}) {
  const tmdbMatch = await findMovieByTmdbId(input.tmdbId, input.mediaType);

  if (tmdbMatch) {
    return tmdbMatch;
  }

  if (!input.title.trim()) {
    return null;
  }

  const result = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM titles
      WHERE LOWER(title) = LOWER($1)
        AND media_type = $2::title_media_type
        AND ($3::date IS NULL OR release_date = $3::date)
      LIMIT 1
    `,
    [input.title.trim(), input.mediaType, input.releaseDate || null],
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
      LEFT JOIN inventory_items i ON i.id = itt.inventory_item_id
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
  overview: string;
  releaseDate: string;
  posterPath: string | null;
  genres: string[];
  director: string;
  cast: Array<{ name: string; character: string }>;
  collection?: TmdbCollectionDraft | null;
}) {
  const duplicateId = await findDuplicateMovieForDraft({
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    title: input.title,
    releaseDate: input.releaseDate,
  });

  if (duplicateId) {
    throw createHttpError(409, "Title already exists");
  }

  const normalizedTitle = input.title.trim();
  const normalizedSortTitle = input.sortTitle.trim() || getSuggestedSortTitle(normalizedTitle);

  if (!normalizedTitle) {
    throw createHttpError(400, 'Field "title" is required');
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
      overview: input.overview.trim(),
      releaseDate: input.releaseDate || "",
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
        title: input.title,
        releaseDate: input.releaseDate,
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
        release_date,
        poster_path,
        genres,
        director,
        cast_members,
        featured
      )
      VALUES ($1, $2, $3, $4::title_media_type, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
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
        release_date = COALESCE(EXCLUDED.release_date, titles.release_date),
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

export async function getAlphabeticalStockSectionsFromDatabase(input: {
  zone?: string;
  zones?: string[];
  formats?: string[];
  view?: string;
}): Promise<StockViewSection[]> {
  const zones =
    input.zones && input.zones.length > 0
      ? input.zones.map((zone) => normalizeZone(zone))
      : input.zone
        ? [normalizeZone(input.zone)]
        : ["W"];
  const view = input.view === "edited-today" ? "edited-today" : "alphabetical";
  const formats =
    input.formats && input.formats.length > 0
      ? input.formats.map((format) => normalizeFormat(format))
      : ["blu-ray"];

  const result = await pool.query<StockDiscRow>(
    `
      SELECT
        i.id,
        i.inventory_code,
        i.format::text,
        i.sealed,
        i.availability,
        i.zone::text,
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
              'season_start', itt.season_start,
              'season_end', itt.season_end,
              'episode_start', itt.episode_start,
              'episode_end', itt.episode_end
            )
            ORDER BY itt.position ASC, t.sort_title ASC
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'::jsonb
        ) AS linked_titles,
        COALESCE(collection_info.anchor_title, primary_title.title, '') AS sort_label,
        COALESCE(collection_info.anchor_sort_title, primary_title.sort_title, primary_title.title, '') AS sort_anchor,
        COALESCE(collection_info.first_position, 0) AS sort_sequence,
        collection_info.collection_name
      FROM inventory_items i
      INNER JOIN inventory_item_titles itt ON itt.inventory_item_id = i.id
      INNER JOIN titles t ON t.id = itt.title_id
      LEFT JOIN LATERAL (
        SELECT
          t0.title,
          t0.sort_title
        FROM inventory_item_titles itt0
        INNER JOIN titles t0 ON t0.id = itt0.title_id
        WHERE itt0.inventory_item_id = i.id
        ORDER BY itt0.position ASC, t0.sort_title ASC, t0.title ASC
        LIMIT 1
      ) AS primary_title ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          c.name AS collection_name,
          c.anchor_title,
          c.anchor_sort_title,
          MIN(ct.position)::int AS first_position
        FROM inventory_item_titles itt0
        INNER JOIN collection_titles ct ON ct.title_id = itt0.title_id
        INNER JOIN collections c ON c.id = ct.collection_id
        WHERE itt0.inventory_item_id = i.id
        GROUP BY c.id, c.name, c.anchor_title, c.anchor_sort_title
        ORDER BY MIN(ct.position) ASC, c.anchor_sort_title ASC, c.name ASC
        LIMIT 1
      ) AS collection_info ON TRUE
      WHERE i.zone = ANY($1::text[])
        AND i.format = ANY($2::inventory_format[])
        AND ($3::text <> 'edited-today' OR i.updated_at >= CURRENT_DATE)
      GROUP BY i.id, primary_title.title, primary_title.sort_title, collection_info.collection_name, collection_info.anchor_title, collection_info.anchor_sort_title, collection_info.first_position
      ORDER BY
        CASE WHEN $3::text = 'edited-today' THEN i.updated_at END DESC NULLS LAST,
        CASE WHEN $3::text <> 'edited-today' THEN i.section END ASC,
        CASE WHEN $3::text <> 'edited-today' THEN COALESCE(collection_info.anchor_sort_title, primary_title.sort_title, primary_title.title, '') END ASC,
        CASE WHEN $3::text <> 'edited-today' THEN COALESCE(collection_info.first_position, 0) END ASC,
        CASE WHEN $3::text <> 'edited-today' THEN primary_title.sort_title END ASC,
        i.created_at ASC;
    `,
    [zones, formats, view],
  );

  const grouped = new Map<string, StockViewDisc[]>();

  for (const row of result.rows) {
    const section = row.section.trim() || "Unsorted";
    const groupKey = `${row.zone}:${section}`;
    const items = grouped.get(groupKey) ?? [];
    items.push(toUiStockDisc(row));
    grouped.set(groupKey, items);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([groupKey, items]) => {
      const [zone, ...sectionParts] = groupKey.split(":");

      return {
        section: `${formatZoneLabel(zone)} / ${sectionParts.join(":")}`,
        items,
      };
    });
}

export async function listStockDiscsFromDatabase(input: {
  preset?: string;
  q?: string;
  section?: string;
  row?: string;
  availability?: string;
  edited?: string;
  formats?: string[];
  primary?: string;
  zones?: string[];
  sealedStates?: string[];
  reviewedState?: string;
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
}): Promise<StockViewPage> {
  const conditions = [];
  const values: Array<string> = [];
  let searchRankSql = "0";
  const preset = input.preset ?? "all";
  const normalizedSort = input.sort ?? "updated";
  const sortDirection = input.dir === "asc" ? "ASC" : "DESC";
  const currentFormatPrioritySql = getFormatPrioritySql("i.format");
  const candidateFormatPrioritySql = getFormatPrioritySql("i_primary.format");
  const pageSize =
    typeof input.pageSize === "number" && Number.isInteger(input.pageSize) && input.pageSize > 0
      ? input.pageSize
      : 50;
  const page =
    typeof input.page === "number" && Number.isInteger(input.page) && input.page > 0
      ? input.page
      : 1;

  if (input.q?.trim()) {
    const normalizedSearch = input.q.trim().toLowerCase();
    const prefixTsQuery = buildPrefixTsQuery(normalizedSearch);
    const allowNotesMatch = normalizedSearch.length >= 3;

    values.push(normalizedSearch);
    const exactIndex = values.length;
    values.push(`${normalizedSearch}%`);
    const prefixIndex = values.length;
    values.push(`%${normalizedSearch}%`);
    const containsIndex = values.length;
    const titleTsIndex = prefixTsQuery ? (values.push(prefixTsQuery), values.length) : null;

    conditions.push(`
      (
        LOWER(i.inventory_code) = $${exactIndex}
        OR LOWER(i.inventory_code) LIKE $${prefixIndex}
        OR LOWER(i.id::text) LIKE $${containsIndex}
        OR LOWER(i.location_code) LIKE $${prefixIndex}
        ${allowNotesMatch ? `OR LOWER(i.notes) LIKE $${containsIndex}` : ""}
        OR EXISTS (
          SELECT 1
          FROM inventory_item_titles ittq
          INNER JOIN titles tq ON tq.id = ittq.title_id
          WHERE ittq.inventory_item_id = i.id
            AND (
              LOWER(tq.title) = $${exactIndex}
              OR LOWER(tq.sort_title) = $${exactIndex}
              OR LOWER(tq.title) LIKE $${prefixIndex}
              OR LOWER(tq.sort_title) LIKE $${prefixIndex}
              OR LOWER(tq.title) LIKE $${containsIndex}
              OR LOWER(tq.sort_title) LIKE $${containsIndex}
              ${titleTsIndex ? `OR ${STOCK_TITLE_SEARCH_VECTOR_SQL} @@ to_tsquery('simple', $${titleTsIndex})` : ""}
            )
        )
      )
    `);

    searchRankSql = `
      (
        CASE WHEN LOWER(i.inventory_code) = $${exactIndex} THEN 500 ELSE 0 END
        + CASE WHEN LOWER(i.inventory_code) LIKE $${prefixIndex} THEN 260 ELSE 0 END
        + CASE
          WHEN EXISTS (
            SELECT 1
            FROM inventory_item_titles ittq
            INNER JOIN titles tq ON tq.id = ittq.title_id
            WHERE ittq.inventory_item_id = i.id
              AND (LOWER(tq.title) = $${exactIndex} OR LOWER(tq.sort_title) = $${exactIndex})
          ) THEN 240
          ELSE 0
        END
        + CASE
          WHEN EXISTS (
            SELECT 1
            FROM inventory_item_titles ittq
            INNER JOIN titles tq ON tq.id = ittq.title_id
            WHERE ittq.inventory_item_id = i.id
              AND (
                LOWER(tq.title) LIKE $${prefixIndex}
                OR LOWER(tq.sort_title) LIKE $${prefixIndex}
              )
          ) THEN 180
          ELSE 0
        END
        + CASE
          WHEN EXISTS (
            SELECT 1
            FROM inventory_item_titles ittq
            INNER JOIN titles tq ON tq.id = ittq.title_id
            WHERE ittq.inventory_item_id = i.id
              AND ${
                titleTsIndex
                  ? `${STOCK_TITLE_SEARCH_VECTOR_SQL} @@ to_tsquery('simple', $${titleTsIndex})`
                  : "FALSE"
              }
          ) THEN 120
          ELSE 0
        END
        + CASE WHEN LOWER(i.location_code) LIKE $${prefixIndex} THEN 80 ELSE 0 END
        + CASE WHEN LOWER(i.id::text) LIKE $${containsIndex} THEN 40 ELSE 0 END
        + CASE WHEN ${allowNotesMatch ? `LOWER(i.notes) LIKE $${containsIndex}` : "FALSE"} THEN 10 ELSE 0 END
      )
    `;
  }

  if (input.availability?.trim() && input.availability !== "all") {
    values.push(input.availability === "available" ? "true" : "false");
    conditions.push(`i.availability = $${values.length}::boolean`);
  }

  if (input.section?.trim()) {
    values.push(input.section.trim().toUpperCase());
    conditions.push(`UPPER(i.section) = $${values.length}`);
  }

  if (input.row?.trim()) {
    values.push(input.row.trim().toUpperCase());
    conditions.push(`UPPER(i.row) = $${values.length}`);
  }

  if (input.edited === "day") {
    conditions.push(`i.updated_at >= NOW() - INTERVAL '1 day'`);
  } else if (input.edited === "week") {
    conditions.push(`i.updated_at >= NOW() - INTERVAL '7 days'`);
  } else if (input.edited === "month") {
    conditions.push(`i.updated_at >= NOW() - INTERVAL '1 month'`);
  }

  const normalizedFormats = Array.isArray(input.formats)
    ? input.formats
        .filter((value) => typeof value === "string" && value.trim() !== "" && value !== "all")
        .map((value) => normalizeFormat(value))
    : [];

  if (normalizedFormats.length > 0) {
    values.push(normalizedFormats.join(","));
    conditions.push(`i.format = ANY(string_to_array($${values.length}, ',')::inventory_format[])`);
  }

  const normalizedZones = Array.isArray(input.zones)
    ? input.zones
        .filter((value) => typeof value === "string" && value.trim() !== "" && value !== "all")
        .map((value) => normalizeZone(value))
    : [];

  if (normalizedZones.length > 0) {
    values.push(normalizedZones.join(","));
    conditions.push(`i.zone = ANY(string_to_array($${values.length}, ','))`);
  }

  const normalizedSealedStates = Array.isArray(input.sealedStates)
    ? Array.from(
        new Set(
          input.sealedStates
            .filter((value) => typeof value === "string" && value.trim() !== "" && value !== "all")
            .map((value) => String(normalizeSealed(value, "sealed"))),
        ),
      )
    : [];

  if (normalizedSealedStates.length === 1) {
    values.push(normalizedSealedStates[0]);
    conditions.push(`i.sealed = $${values.length}::boolean`);
  }

  if (input.reviewedState === "true") {
    conditions.push(`i.reviewed = TRUE`);
  } else if (input.reviewedState === "false") {
    conditions.push(`i.reviewed = FALSE`);
  }

  if (preset === "available") {
    conditions.push(`i.availability = TRUE`);
  } else if (preset === "edited-today") {
    conditions.push(`i.updated_at >= NOW() - INTERVAL '1 day'`);
  } else if (preset === "unavailable") {
    conditions.push(`i.availability = FALSE`);
  } else if (preset === "needs-review") {
    conditions.push(`i.reviewed = FALSE`);
  } else if (preset === "sealed") {
    conditions.push(`i.sealed = TRUE`);
  }

  const primaryPredicateSql = `
    EXISTS (
      SELECT 1
      FROM inventory_item_titles itt0
      WHERE itt0.inventory_item_id = i.id
        AND NOT EXISTS (
          SELECT 1
          FROM inventory_item_titles itt_primary
          INNER JOIN inventory_items i_primary ON i_primary.id = itt_primary.inventory_item_id
          WHERE itt_primary.title_id = itt0.title_id
            AND (
              ${candidateFormatPrioritySql} < ${currentFormatPrioritySql}
              OR (
                ${candidateFormatPrioritySql} = ${currentFormatPrioritySql}
                AND COALESCE(i_primary.inventory_code, i_primary.id::text) < COALESCE(i.inventory_code, i.id::text)
              )
            )
        )
    )
  `;

  if (input.primary === "primary") {
    conditions.push(primaryPredicateSql);
  } else if (input.primary === "duplicate") {
    conditions.push(`NOT (${primaryPredicateSql})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sortTitleFallbackSql =
    `COALESCE(collection_info.anchor_sort_title, primary_title.sort_title, primary_title.title, '') ASC, ` +
    `COALESCE(collection_info.first_position, 0) ASC, ` +
    `primary_title.sort_title ASC, primary_title.title ASC, COALESCE(i.inventory_code, i.id::text) ASC`;

  const sortSql = (() => {
    switch (normalizedSort) {
      case "disc":
        return `COALESCE(i.inventory_code, i.id::text) ${sortDirection}, ${sortTitleFallbackSql}`;
      case "format":
        return `i.format ${sortDirection}, ${sortTitleFallbackSql}`;
      case "primary":
        return `COALESCE(primary_info.is_primary, FALSE) ${sortDirection}, COALESCE(i.inventory_code, i.id::text) DESC, ${sortTitleFallbackSql}`;
      case "availability":
        return `i.availability ${sortDirection}, ${sortTitleFallbackSql}`;
      case "titles":
        return `${sortTitleFallbackSql}`;
      case "order":
        return `COALESCE(collection_info.anchor_sort_title, primary_title.sort_title, primary_title.title, '') ${sortDirection}, COALESCE(collection_info.first_position, 0) ASC, primary_title.sort_title ASC, primary_title.title ASC, COALESCE(i.inventory_code, i.id::text) ASC`;
      case "location":
        return `i.zone ${sortDirection}, i.section ${sortDirection}, i.row ${sortDirection} NULLS LAST, ${sortTitleFallbackSql}`;
      case "reviewed":
        return `i.reviewed ${sortDirection}, ${sortTitleFallbackSql}`;
      case "sealed":
        return `i.sealed ${sortDirection}, ${sortTitleFallbackSql}`;
      case "updated":
      default:
        return `i.updated_at ${sortDirection}, ${sortTitleFallbackSql}`;
    }
  })();

  const countResult = await pool.query<{ count: string }>(
    `
      SELECT COUNT(DISTINCT i.id)::text AS count
      FROM inventory_items i
      INNER JOIN inventory_item_titles itt ON itt.inventory_item_id = i.id
      INNER JOIN titles t ON t.id = itt.title_id
      ${whereClause};
    `,
    values,
  );

  const totalCount = Number.parseInt(countResult.rows[0]?.count ?? "0", 10);
  const safePage = totalCount === 0 ? 1 : Math.min(page, Math.ceil(totalCount / pageSize));
  const offset = (safePage - 1) * pageSize;
  const pagedValues = [...values, pageSize.toString(), offset.toString()];

  const result = await pool.query<StockDiscRow>(
    `
      SELECT
        i.id,
        i.inventory_code,
        i.format::text,
        i.sealed,
        i.availability,
        i.reviewed,
        COALESCE(primary_info.is_primary, FALSE) AS is_primary,
        ${searchRankSql}::numeric AS search_rank,
        i.zone::text,
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
              'media_type', t.media_type::text,
              'release_date', t.release_date,
              'season_start', itt.season_start,
              'season_end', itt.season_end,
              'episode_start', itt.episode_start,
              'episode_end', itt.episode_end
            )
            ORDER BY itt.position ASC, t.sort_title ASC
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'::jsonb
        ) AS linked_titles,
        COALESCE(collection_info.anchor_title, primary_title.title, '') AS sort_label,
        COALESCE(collection_info.anchor_sort_title, primary_title.sort_title, primary_title.title, '') AS sort_anchor,
        COALESCE(collection_info.first_position, 0) AS sort_sequence,
        collection_info.collection_name
      FROM inventory_items i
      INNER JOIN inventory_item_titles itt ON itt.inventory_item_id = i.id
      INNER JOIN titles t ON t.id = itt.title_id
      LEFT JOIN LATERAL (
        SELECT
          t0.title,
          t0.sort_title
        FROM inventory_item_titles itt0
        INNER JOIN titles t0 ON t0.id = itt0.title_id
        WHERE itt0.inventory_item_id = i.id
        ORDER BY itt0.position ASC, t0.sort_title ASC, t0.title ASC
        LIMIT 1
      ) AS primary_title ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          c.name AS collection_name,
          c.anchor_title,
          c.anchor_sort_title,
          MIN(ct.position)::int AS first_position
        FROM inventory_item_titles itt0
        INNER JOIN collection_titles ct ON ct.title_id = itt0.title_id
        INNER JOIN collections c ON c.id = ct.collection_id
        WHERE itt0.inventory_item_id = i.id
        GROUP BY c.id, c.name, c.anchor_title, c.anchor_sort_title
        ORDER BY MIN(ct.position) ASC, c.anchor_sort_title ASC, c.name ASC
        LIMIT 1
      ) AS collection_info ON TRUE
      LEFT JOIN LATERAL (
        SELECT BOOL_OR(
          NOT EXISTS (
            SELECT 1
            FROM inventory_item_titles itt_primary
            INNER JOIN inventory_items i_primary ON i_primary.id = itt_primary.inventory_item_id
            WHERE itt_primary.title_id = itt0.title_id
              AND (
                ${candidateFormatPrioritySql} < ${currentFormatPrioritySql}
                OR (
                  ${candidateFormatPrioritySql} = ${currentFormatPrioritySql}
                  AND COALESCE(i_primary.inventory_code, i_primary.id::text) < COALESCE(i.inventory_code, i.id::text)
                )
              )
          )
        ) AS is_primary
        FROM inventory_item_titles itt0
        WHERE itt0.inventory_item_id = i.id
      ) AS primary_info ON TRUE
      ${whereClause}
      GROUP BY i.id, primary_info.is_primary, primary_title.title, primary_title.sort_title, collection_info.collection_name, collection_info.anchor_title, collection_info.anchor_sort_title, collection_info.first_position
      ORDER BY ${input.q?.trim() ? "search_rank DESC, " : ""}${sortSql}
      LIMIT $${values.length + 1}::int
      OFFSET $${values.length + 2}::int;
    `,
    pagedValues,
  );

  return {
    items: result.rows.map(toUiStockDisc),
    totalCount,
  };
}

export async function getStockViewOptionsFromDatabase() {
  const sectionResult = await pool.query<{ section: string }>(
    `
      SELECT DISTINCT section
      FROM inventory_items
      WHERE section <> ''
      ORDER BY section ASC;
    `,
  );

  return {
    sections: sectionResult.rows.map((row) => row.section),
  };
}

export async function createInventoryItemInDatabase(body: Record<string, unknown>) {
  const titleLinks = parseInventoryTitleLinks(body);
  const titleIds = titleLinks.map((link) => link.titleId);

  const format = normalizeFormat(body.format);
  const sealed =
    body.sealed !== undefined
      ? normalizeSealed(body.sealed)
      : body.condition !== undefined
        ? normalizeSealed(body.condition, "condition")
        : false;
  const zone = normalizeZone(body.zone);
  const section = normalizeLocationPart(body.section, "section");
  const row = normalizeRowPart(body.row);
  const locationCode = buildLocationCode(zone, section, row);
  const notes = optionalString(body.notes) ?? "";
  const lastRentedAt = optionalString(body.last_rented_at);
  const availability =
    body.availability === undefined ? true : normalizeAvailability(body.availability);
  const reviewed = body.reviewed === undefined ? false : normalizeAvailability(body.reviewed);
  const dayPrice = body.day_price === undefined ? 0 : normalizeMoney(body.day_price, "day_price");
  const weekendPrice =
    body.weekend_price === undefined ? 0 : normalizeMoney(body.weekend_price, "weekend_price");
  const lateClass = body.late_class === undefined ? 0 : normalizeLateClass(body.late_class);

  await ensureTitlesExist(titleIds);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const inventoryCode = await allocateLowestInventoryCode(client);

    const inventoryResult = await client.query<{ id: string; inventory_code: string }>(
      `
        INSERT INTO inventory_items (
          inventory_code,
          availability,
          reviewed,
          sealed,
          format,
          zone,
          section,
          row,
          location_code,
          notes,
          last_rented_at,
          day_price,
          weekend_price,
          late_class
        )
        VALUES ($1, $2, $3, $4, $5::inventory_format, $6, $7, $8, $9, $10, $11::timestamptz, $12::numeric(10,2), $13::numeric(10,2), $14::integer)
        RETURNING id, inventory_code;
      `,
      [
        inventoryCode,
        availability,
        reviewed,
        sealed,
        format,
        zone,
        section,
        row,
        locationCode,
        notes,
        lastRentedAt,
        dayPrice,
        weekendPrice,
        lateClass,
      ],
    );

    const inventoryItemId = inventoryResult.rows[0].id;
    const createdInventoryCode = inventoryResult.rows[0].inventory_code;

    for (const [index, titleLink] of titleLinks.entries()) {
      await client.query(
        `
          INSERT INTO inventory_item_titles (
            inventory_item_id,
            title_id,
            season_start,
            season_end,
            episode_start,
            episode_end,
            position
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          inventoryItemId,
          titleLink.titleId,
          titleLink.seasonStart,
          titleLink.seasonEnd,
          titleLink.episodeStart,
          titleLink.episodeEnd,
          index + 1,
        ],
      );
    }

    await client.query("COMMIT");
    return { id: inventoryItemId, inventoryCode: createdInventoryCode };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function generateInventoryCodeForDisc(id: string) {
  const result = await pool.query<{ id: string; inventory_code: string }>(
    `
      UPDATE inventory_items
      SET updated_at = NOW()
      WHERE id = $1
      RETURNING id, inventory_code;
    `,
    [id],
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, "Inventory item not found");
  }

  return {
    id: result.rows[0].id,
    inventoryCode: result.rows[0].inventory_code,
  };
}

export async function clearInventoryCodeForDisc(_discId?: string) {
  void _discId;
  throw createHttpError(400, "Disc codes are permanent");
}

export async function updateMovieInDatabase(id: string, body: Record<string, unknown>) {
  const title = body.title === undefined ? null : requireNonEmptyString(body.title, "title");
  const sortTitle =
    body.sort_title === undefined ? null : requireNonEmptyString(body.sort_title, "sort_title");
  const overview = body.overview === undefined ? null : (optionalString(body.overview) ?? "");
  const releaseDate = body.release_date === undefined ? null : optionalString(body.release_date);
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
        release_date = COALESCE($5::date, release_date),
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

export async function updateInventoryItemInDatabase(id: string, body: Record<string, unknown>) {
  const titleLinks = body.title_links === undefined ? null : parseInventoryTitleLinks(body);
  const updateValues = {
    format: body.format === undefined ? null : normalizeFormat(body.format),
    availability: body.availability === undefined ? null : normalizeAvailability(body.availability),
    reviewed: body.reviewed === undefined ? null : normalizeAvailability(body.reviewed),
    sealed:
      body.sealed !== undefined
        ? normalizeSealed(body.sealed)
        : body.condition !== undefined
          ? normalizeSealed(body.condition, "condition")
          : null,
    zone: body.zone === undefined ? null : normalizeZone(body.zone),
    section: body.section === undefined ? null : normalizeLocationPart(body.section, "section"),
    row: body.row === undefined ? null : normalizeRowPart(body.row),
    notes: body.notes === undefined ? null : (optionalString(body.notes) ?? ""),
    lastRentedAt: body.last_rented_at === undefined ? null : optionalString(body.last_rented_at),
    dayPrice: body.day_price === undefined ? null : normalizeMoney(body.day_price, "day_price"),
    weekendPrice:
      body.weekend_price === undefined ? null : normalizeMoney(body.weekend_price, "weekend_price"),
    lateClass: body.late_class === undefined ? null : normalizeLateClass(body.late_class),
  };

  if (Object.values(updateValues).every((value) => value === null) && titleLinks === null) {
    throw createHttpError(400, "Request body must include at least one updatable field");
  }
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
        UPDATE inventory_items
        SET
          format = COALESCE($2::inventory_format, format),
          availability = COALESCE($3, availability),
          reviewed = COALESCE($4, reviewed),
          sealed = COALESCE($5, sealed),
          zone = COALESCE($6, zone),
          section = COALESCE($7, section),
          row = COALESCE($8, row),
          location_code = CONCAT(COALESCE($6, zone), '/', COALESCE($7, section), COALESCE($8, row)),
          notes = COALESCE($9, notes),
          last_rented_at = COALESCE($10::timestamptz, last_rented_at),
          day_price = COALESCE($11::numeric(10,2), day_price),
          weekend_price = COALESCE($12::numeric(10,2), weekend_price),
          late_class = COALESCE($13::integer, late_class),
          updated_at = NOW()
        WHERE id = $1
        RETURNING id;
      `,
      [
        id,
        updateValues.format,
        updateValues.availability,
        updateValues.reviewed,
        updateValues.sealed,
        updateValues.zone,
        updateValues.section,
        updateValues.row,
        updateValues.notes,
        updateValues.lastRentedAt,
        updateValues.dayPrice,
        updateValues.weekendPrice,
        updateValues.lateClass,
      ],
    );

    if (result.rowCount === 0) {
      throw createHttpError(404, "Inventory item not found");
    }

    if (titleLinks !== null) {
      for (const titleLink of titleLinks) {
        const updateLinkResult = await client.query(
          `
            UPDATE inventory_item_titles
            SET season_start = $3,
                season_end = $4,
                episode_start = $5,
                episode_end = $6
            WHERE inventory_item_id = $1
              AND title_id = $2
            RETURNING inventory_item_id;
          `,
          [
            id,
            titleLink.titleId,
            titleLink.seasonStart,
            titleLink.seasonEnd,
            titleLink.episodeStart,
            titleLink.episodeEnd,
          ],
        );

        if (updateLinkResult.rowCount === 0) {
          throw createHttpError(404, "One or more linked titles were not found for the disc");
        }
      }
    }

    await client.query("COMMIT");
    return { id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
