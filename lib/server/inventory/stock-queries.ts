import "server-only";

import { formatZoneLabel } from "@/lib/constants";
import { pool } from "@/lib/server/db";
import { normalizeInventoryZone as normalizeZone } from "@/lib/server/inventory/location-input";
import {
  formatDateOnly,
  formatPosterUrl,
  formatTimestamp,
  normalizeFormat,
  normalizeSealed,
} from "@/lib/server/http";
import type {
  InventoryItem,
  LinkedTitle,
  StockViewDisc,
  StockViewPage,
  StockViewSection,
} from "@/lib/types";

const STOCK_TITLE_SEARCH_VECTOR_SQL = `
  (
    setweight(to_tsvector('simple', COALESCE(tq.title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(tq.sort_title, '')), 'A')
  )
`;

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

type StockDiscRow = InventoryItemRow & {
  is_primary: boolean;
  sort_label: string;
  sort_anchor: string;
  sort_sequence: number;
  collection_name: string | null;
};

function getFormatPrioritySql(column: string) {
  return `(CASE ${column}::text WHEN '4k-uhd' THEN 0 WHEN 'blu-ray' THEN 1 WHEN 'dvd' THEN 2 ELSE 3 END)`;
}

function buildPrefixTsQuery(query: string) {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.length === 0 ? null : tokens.map((token) => `${token}:*`).join(" & ");
}

function getSuggestedSortTitle(title: string) {
  return title.replace(/^(a|an|the)\s+/i, "").trim() || title.trim();
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
        i.upc_ean,
        i.format::text,
        i.sealed,
        i.availability,
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
        ) AS linked_music_release,
        COALESCE(collection_info.anchor_title, primary_title.title, linked_release.title, '') AS sort_label,
        COALESCE(collection_info.anchor_sort_title, primary_title.sort_title, primary_title.title, linked_release.sort_title, linked_release.title, '') AS sort_anchor,
        COALESCE(collection_info.first_position, 0) AS sort_sequence,
        collection_info.collection_name
      FROM inventory_items i
      LEFT JOIN inventory_item_titles itt ON itt.inventory_item_id = i.id
      LEFT JOIN titles t ON t.id = itt.title_id
      LEFT JOIN LATERAL (
        SELECT mr.title, mr.sort_title
        FROM inventory_item_music_releases imr
        INNER JOIN music_releases mr ON mr.id = imr.music_release_id
        WHERE imr.inventory_item_id = i.id
        LIMIT 1
      ) AS linked_release ON TRUE
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
        AND (t.id IS NOT NULL OR linked_release.title IS NOT NULL)
        AND ($3::text <> 'edited-today' OR i.updated_at >= CURRENT_DATE)
      GROUP BY i.id, primary_title.title, primary_title.sort_title, linked_release.title, linked_release.sort_title, collection_info.collection_name, collection_info.anchor_title, collection_info.anchor_sort_title, collection_info.first_position
      ORDER BY
        CASE WHEN $3::text = 'edited-today' THEN i.updated_at END DESC NULLS LAST,
        CASE WHEN $3::text <> 'edited-today' THEN i.section END ASC,
        CASE WHEN $3::text <> 'edited-today' THEN COALESCE(collection_info.anchor_sort_title, primary_title.sort_title, primary_title.title, linked_release.sort_title, linked_release.title, '') END ASC,
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
        section: `${items[0]?.zoneLabel ?? formatZoneLabel(zone)} / ${sectionParts.join(":")}`,
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
    const musicReleaseSearchSql = `EXISTS (
      SELECT 1 FROM inventory_item_music_releases imrq
      INNER JOIN music_releases mrq ON mrq.id = imrq.music_release_id
      WHERE imrq.inventory_item_id = i.id
        AND (
          LOWER(mrq.title) LIKE $${prefixIndex}
          OR LOWER(mrq.sort_title) LIKE $${prefixIndex}
          OR LOWER(mrq.artist_credit) LIKE $${containsIndex}
        )
    )`;

    conditions.push(`
      (
        LOWER(i.inventory_code) = $${exactIndex}
        OR LOWER(i.inventory_code) LIKE $${prefixIndex}
        OR LOWER(i.id::text) LIKE $${containsIndex}
        OR LOWER(i.location_code) LIKE $${prefixIndex}
        ${allowNotesMatch ? `OR LOWER(i.notes) LIKE $${containsIndex}` : ""}
        OR ${musicReleaseSearchSql}
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
        + CASE WHEN ${musicReleaseSearchSql} THEN 160 ELSE 0 END
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

  const excludedFormats = Array.isArray(input.excludeFormats)
    ? input.excludeFormats
        .filter((value) => typeof value === "string" && value.trim() !== "")
        .map((value) => normalizeFormat(value))
    : [];
  if (!normalizedFormats.includes("cd") && !excludedFormats.includes("cd")) {
    excludedFormats.push("cd");
  }
  if (excludedFormats.length > 0) {
    values.push(excludedFormats.join(","));
    conditions.push(`i.format <> ALL(string_to_array($${values.length}, ',')::inventory_format[])`);
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

  conditions.push(`(
    EXISTS (SELECT 1 FROM inventory_item_titles catalog_link WHERE catalog_link.inventory_item_id = i.id)
    OR EXISTS (SELECT 1 FROM inventory_item_music_releases music_link WHERE music_link.inventory_item_id = i.id)
  )`);

  const primaryPredicateSql = `
    (EXISTS (
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
    ) OR EXISTS (
      SELECT 1 FROM inventory_item_music_releases imr
      WHERE imr.inventory_item_id = i.id
    ))
  `;

  if (input.primary === "primary") {
    conditions.push(primaryPredicateSql);
  } else if (input.primary === "duplicate") {
    conditions.push(`NOT (${primaryPredicateSql})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sortTitleFallbackSql =
    `COALESCE(collection_info.anchor_sort_title, primary_title.sort_title, primary_title.title, linked_release.sort_title, linked_release.title, '') ASC, ` +
    `COALESCE(collection_info.first_position, 0) ASC, ` +
    `primary_title.sort_title ASC, primary_title.title ASC, linked_release.sort_title ASC, linked_release.title ASC, COALESCE(i.inventory_code, i.id::text) ASC`;

  const sortSql = (() => {
    switch (normalizedSort) {
      case "disc":
        return `COALESCE(i.inventory_code, i.id::text) ${sortDirection}, ${sortTitleFallbackSql}`;
      case "format":
        return `i.format ${sortDirection}, ${sortTitleFallbackSql}`;
      case "primary":
        return `COALESCE(primary_info.is_primary, TRUE) ${sortDirection}, COALESCE(i.inventory_code, i.id::text) DESC, ${sortTitleFallbackSql}`;
      case "availability":
        return `i.availability ${sortDirection}, ${sortTitleFallbackSql}`;
      case "titles":
        return `${sortTitleFallbackSql}`;
      case "order":
        return `COALESCE(collection_info.anchor_sort_title, primary_title.sort_title, primary_title.title, linked_release.sort_title, linked_release.title, '') ${sortDirection}, COALESCE(collection_info.first_position, 0) ASC, primary_title.sort_title ASC, primary_title.title ASC, linked_release.sort_title ASC, linked_release.title ASC, COALESCE(i.inventory_code, i.id::text) ASC`;
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
        i.upc_ean,
        i.format::text,
        i.sealed,
        i.availability,
        i.reviewed,
        COALESCE(primary_info.is_primary, TRUE) AS is_primary,
        ${searchRankSql}::numeric AS search_rank,
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
        ) AS linked_music_release,
        COALESCE(collection_info.anchor_title, primary_title.title, linked_release.title, '') AS sort_label,
        COALESCE(collection_info.anchor_sort_title, primary_title.sort_title, primary_title.title, linked_release.sort_title, linked_release.title, '') AS sort_anchor,
        COALESCE(collection_info.first_position, 0) AS sort_sequence,
        collection_info.collection_name
      FROM inventory_items i
      LEFT JOIN inventory_item_titles itt ON itt.inventory_item_id = i.id
      LEFT JOIN titles t ON t.id = itt.title_id
      LEFT JOIN LATERAL (
        SELECT mr.title, mr.sort_title
        FROM inventory_item_music_releases imr
        INNER JOIN music_releases mr ON mr.id = imr.music_release_id
        WHERE imr.inventory_item_id = i.id
        LIMIT 1
      ) AS linked_release ON TRUE
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
      GROUP BY i.id, primary_info.is_primary, primary_title.title, primary_title.sort_title, linked_release.title, linked_release.sort_title, collection_info.collection_name, collection_info.anchor_title, collection_info.anchor_sort_title, collection_info.first_position
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
