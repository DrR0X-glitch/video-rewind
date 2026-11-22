import "server-only";

import { normalizeUpcEanInput, UpcEanInputError } from "@/lib/inventory/upc-ean";
import {
  buildInventoryLocationCode,
  normalizeInventoryLocationPart,
  normalizeInventoryRow,
  normalizeInventoryZone,
} from "@/lib/server/inventory/location-input";
import { assertInventoryZoneIsAssignable } from "@/lib/server/inventory/zones";
import { pool } from "@/lib/server/db";
import {
  createHttpError,
  normalizeAvailability,
  normalizeFormat,
  normalizeLateClass,
  normalizeMoney,
  normalizeSealed,
  optionalString,
} from "@/lib/server/http";

type InventoryTitleLink = {
  titleId: string;
  seasonStart: number | null;
  seasonEnd: number | null;
  episodeStart: number | null;
  episodeEnd: number | null;
};

export function normalizeInventoryUpcEan(value: unknown) {
  try {
    return normalizeUpcEanInput(value);
  } catch (error) {
    if (error instanceof UpcEanInputError) {
      throw createHttpError(400, error.message);
    }
    throw error;
  }
}

async function allocateLowestInventoryCode(client: { query: typeof pool.query }) {
  const result = await client.query<{ inventory_code: string }>(`
    SELECT LPAD(candidate.code::text, 6, '0') AS inventory_code
    FROM generate_series(1, 999999) AS candidate(code)
    LEFT JOIN inventory_items i
      ON i.inventory_code = LPAD(candidate.code::text, 6, '0')
    WHERE i.inventory_code IS NULL
    ORDER BY candidate.code ASC
    LIMIT 1;
  `);

  const inventoryCode = result.rows[0]?.inventory_code;
  if (!inventoryCode) throw createHttpError(409, "No disc codes are available");
  return inventoryCode;
}

async function ensureTitlesExist(titleIds: string[]) {
  if (titleIds.length === 0) {
    throw createHttpError(400, 'Field "title_ids" must include at least one title');
  }

  const result = await pool.query<{ id: string }>(
    "SELECT id FROM titles WHERE id = ANY($1::uuid[])",
    [titleIds],
  );
  if (result.rowCount !== titleIds.length) {
    throw createHttpError(404, "One or more titles were not found");
  }
}

function normalizeSeasonNumber(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  throw createHttpError(400, `Field "${fieldName}" is invalid`);
}

function validateSeasonRange(link: InventoryTitleLink): InventoryTitleLink {
  if (link.seasonEnd !== null && link.seasonStart === null) {
    throw createHttpError(400, 'Field "season_end" requires "season_start"');
  }
  if (link.seasonStart !== null && link.seasonEnd !== null && link.seasonEnd < link.seasonStart) {
    throw createHttpError(
      400,
      'Field "season_end" must be greater than or equal to "season_start"',
    );
  }
  if (link.episodeEnd !== null && link.episodeStart === null) {
    throw createHttpError(400, 'Field "episode_end" requires "episode_start"');
  }
  if (
    link.episodeStart !== null &&
    link.episodeEnd !== null &&
    link.episodeEnd < link.episodeStart
  ) {
    throw createHttpError(
      400,
      'Field "episode_end" must be greater than or equal to "episode_start"',
    );
  }
  if (link.episodeStart !== null && link.seasonStart === null) {
    throw createHttpError(400, 'Field "episode_start" requires "season_start"');
  }

  const normalizedSeasonEnd = link.seasonEnd ?? link.seasonStart;
  if (
    link.episodeStart !== null &&
    link.seasonStart !== null &&
    normalizedSeasonEnd !== null &&
    normalizedSeasonEnd !== link.seasonStart
  ) {
    throw createHttpError(400, "Episode ranges require a single season");
  }

  return {
    ...link,
    seasonEnd: normalizedSeasonEnd,
    episodeEnd: link.episodeEnd ?? link.episodeStart,
  };
}

function parseInventoryTitleLinks(body: Record<string, unknown>) {
  if (Array.isArray(body.title_links)) {
    const links = body.title_links.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const titleId = optionalString(value.title_id);
      if (!titleId) return [];
      return [
        validateSeasonRange({
          titleId,
          seasonStart: normalizeSeasonNumber(value.season_start, "season_start"),
          seasonEnd: normalizeSeasonNumber(value.season_end, "season_end"),
          episodeStart: normalizeSeasonNumber(value.episode_start, "episode_start"),
          episodeEnd: normalizeSeasonNumber(value.episode_end, "episode_end"),
        }),
      ];
    });
    if (links.length > 0) return links;
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
      seasonStart: normalizeSeasonNumber(seasonStarts[index], "season_start"),
      seasonEnd: normalizeSeasonNumber(seasonEnds[index], "season_end"),
      episodeStart: normalizeSeasonNumber(episodeStarts[index], "episode_start"),
      episodeEnd: normalizeSeasonNumber(episodeEnds[index], "episode_end"),
    }),
  );
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
  const zone = normalizeInventoryZone(body.zone);
  await assertInventoryZoneIsAssignable(zone);
  const section = normalizeInventoryLocationPart(body.section, "section");
  const row = normalizeInventoryRow(body.row);
  const locationCode = buildInventoryLocationCode(zone, section, row);
  const notes = optionalString(body.notes) ?? "";
  const upcEan = normalizeInventoryUpcEan(body.upc_ean);
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
          inventory_code, upc_ean, availability, reviewed, sealed, format,
          zone, section, row, location_code, notes, last_rented_at,
          day_price, weekend_price, late_class
        )
        VALUES ($1, $2, $3, $4, $5, $6::inventory_format, $7, $8, $9, $10, $11, $12::timestamptz, $13::numeric(10,2), $14::numeric(10,2), $15::integer)
        RETURNING id, inventory_code;
      `,
      [
        inventoryCode,
        upcEan,
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
    for (const [index, titleLink] of titleLinks.entries()) {
      await client.query(
        `
          INSERT INTO inventory_item_titles (
            inventory_item_id, title_id, season_start, season_end,
            episode_start, episode_end, position
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
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
    return { id: inventoryItemId, inventoryCode: inventoryResult.rows[0].inventory_code };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateInventoryItemInDatabase(id: string, body: Record<string, unknown>) {
  const titleLinks = body.title_links === undefined ? null : parseInventoryTitleLinks(body);
  const updateValues = {
    upcEan: body.upc_ean === undefined ? null : normalizeInventoryUpcEan(body.upc_ean),
    format: body.format === undefined ? null : normalizeFormat(body.format),
    availability: body.availability === undefined ? null : normalizeAvailability(body.availability),
    reviewed: body.reviewed === undefined ? null : normalizeAvailability(body.reviewed),
    sealed:
      body.sealed !== undefined
        ? normalizeSealed(body.sealed)
        : body.condition !== undefined
          ? normalizeSealed(body.condition, "condition")
          : null,
    zone: body.zone === undefined ? null : normalizeInventoryZone(body.zone),
    section:
      body.section === undefined ? null : normalizeInventoryLocationPart(body.section, "section"),
    row: body.row === undefined ? null : normalizeInventoryRow(body.row),
    notes: body.notes === undefined ? null : (optionalString(body.notes) ?? ""),
    lastRentedAt: body.last_rented_at === undefined ? null : optionalString(body.last_rented_at),
    dayPrice: body.day_price === undefined ? null : normalizeMoney(body.day_price, "day_price"),
    weekendPrice:
      body.weekend_price === undefined ? null : normalizeMoney(body.weekend_price, "weekend_price"),
    lateClass: body.late_class === undefined ? null : normalizeLateClass(body.late_class),
  };

  if (updateValues.zone !== null) await assertInventoryZoneIsAssignable(updateValues.zone, id);
  if (
    Object.values(updateValues).every((value) => value === null) &&
    body.upc_ean === undefined &&
    titleLinks === null
  ) {
    throw createHttpError(400, "Request body must include at least one updatable field");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        UPDATE inventory_items
        SET upc_ean = CASE WHEN $2::boolean THEN $3 ELSE upc_ean END,
            format = COALESCE($4::inventory_format, format),
            availability = COALESCE($5, availability),
            reviewed = COALESCE($6, reviewed),
            sealed = COALESCE($7, sealed),
            zone = COALESCE($8, zone),
            section = COALESCE($9, section),
            row = COALESCE($10, row),
            location_code = CONCAT(COALESCE($8, zone), '/', COALESCE($9, section), COALESCE($10, row)),
            notes = COALESCE($11, notes),
            last_rented_at = COALESCE($12::timestamptz, last_rented_at),
            day_price = COALESCE($13::numeric(10,2), day_price),
            weekend_price = COALESCE($14::numeric(10,2), weekend_price),
            late_class = COALESCE($15::integer, late_class),
            updated_at = NOW()
        WHERE id = $1
        RETURNING id;
      `,
      [
        id,
        updateValues.upcEan !== null || body.upc_ean !== undefined,
        updateValues.upcEan,
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
    if (result.rowCount === 0) throw createHttpError(404, "Inventory item not found");

    if (titleLinks !== null) {
      for (const titleLink of titleLinks) {
        const updateLinkResult = await client.query(
          `
            UPDATE inventory_item_titles
            SET season_start = $3, season_end = $4, episode_start = $5, episode_end = $6
            WHERE inventory_item_id = $1 AND title_id = $2
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
