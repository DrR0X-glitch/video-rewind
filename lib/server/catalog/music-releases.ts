import "server-only";

import type { DiscogsReleaseDraft, DiscogsTrackDraft } from "@/lib/server/catalog/discogs";
import { createHttpError } from "@/lib/server/http";
import { pool } from "@/lib/server/db";

export type MusicReleaseTrackSnapshot = DiscogsTrackDraft;
export type MusicReleaseSnapshot = Omit<DiscogsReleaseDraft, "barcode" | "artworkUrl">;

type PersistedMusicRelease = {
  id: string;
  source: "discogs" | "manual";
  discogs_release_id: string | null;
  title: string;
  sort_title: string;
  artist_credit: string;
  release_year: number | null;
  country: string | null;
  label: string | null;
  catalog_number: string | null;
  discogs_url: string | null;
  source_fetched_at: Date | null;
};

function optionalText(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function normalizeSortTitle(value: unknown, title: string, required = false) {
  if (value !== undefined && typeof value !== "string") {
    throw createHttpError(400, 'Field "sortTitle" must be text');
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  const sortTitle = normalized || title.replace(/^(a|an|the)\s+/i, "").trim() || title.trim();
  if (required && !normalized) {
    throw createHttpError(400, 'Field "sortTitle" is required');
  }
  if (!sortTitle || sortTitle.length > 500) {
    throw createHttpError(400, 'Field "sortTitle" is required and must be at most 500 characters');
  }
  return sortTitle;
}

function validateReleaseSnapshot(snapshot: MusicReleaseSnapshot) {
  if (!Number.isSafeInteger(snapshot.discogsReleaseId) || snapshot.discogsReleaseId <= 0) {
    throw createHttpError(400, "Discogs release ID is invalid");
  }
  if (typeof snapshot.title !== "string" || !snapshot.title.trim()) {
    throw createHttpError(400, "Discogs release title is required");
  }
  if (
    snapshot.releaseYear !== null &&
    (!Number.isInteger(snapshot.releaseYear) ||
      snapshot.releaseYear < 1 ||
      snapshot.releaseYear > 9999)
  ) {
    throw createHttpError(400, "Discogs release year is invalid");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(snapshot.discogsUrl);
  } catch {
    throw createHttpError(400, "Discogs release URL is invalid");
  }
  if (
    parsedUrl.protocol !== "https:" ||
    !["discogs.com", "www.discogs.com"].includes(parsedUrl.hostname) ||
    !parsedUrl.pathname.startsWith(`/release/${snapshot.discogsReleaseId}`)
  ) {
    throw createHttpError(400, "Discogs release URL must link to the selected release");
  }

  if (!Array.isArray(snapshot.artists) || !Array.isArray(snapshot.tracks)) {
    throw createHttpError(400, "Discogs release data is invalid");
  }

  const sequenceNumbers = new Set<number>();
  for (const track of snapshot.tracks) {
    if (!Number.isSafeInteger(track.sequenceNo) || track.sequenceNo < 1) {
      throw createHttpError(400, "Discogs track order is invalid");
    }
    if (sequenceNumbers.has(track.sequenceNo)) {
      throw createHttpError(400, "Discogs track order contains duplicates");
    }
    if (typeof track.title !== "string" || !track.title.trim()) {
      throw createHttpError(400, "Discogs track title is required");
    }
    if (track.entryType !== "track" && track.entryType !== "heading") {
      throw createHttpError(400, "Discogs track entry type is invalid");
    }
    if (
      track.durationSeconds !== null &&
      (!Number.isSafeInteger(track.durationSeconds) || track.durationSeconds < 0)
    ) {
      throw createHttpError(400, "Discogs track duration is invalid");
    }
    if (track.entryType === "heading" && track.durationSeconds !== null) {
      throw createHttpError(400, "Discogs headings cannot have a track duration");
    }
    sequenceNumbers.add(track.sequenceNo);
  }

  for (const track of snapshot.tracks) {
    if (
      track.parentSequenceNo !== null &&
      (track.parentSequenceNo === track.sequenceNo || !sequenceNumbers.has(track.parentSequenceNo))
    ) {
      throw createHttpError(400, "Discogs track parent is invalid");
    }
  }
}

/** Persist a normalized Discogs CC0 release snapshot and its ordered track list atomically. */
export async function storeDiscogsMusicRelease(
  snapshot: MusicReleaseSnapshot,
  sortTitleValue?: unknown,
) {
  validateReleaseSnapshot(snapshot);
  const sortTitle = normalizeSortTitle(sortTitleValue, snapshot.title);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const releaseResult = await client.query<PersistedMusicRelease>(
      `
        INSERT INTO music_releases (
          discogs_release_id, title, sort_title, artist_credit, release_year, country,
          label, catalog_number, discogs_url, source_fetched_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        ON CONFLICT (discogs_release_id) DO UPDATE
        SET title = EXCLUDED.title,
            sort_title = EXCLUDED.sort_title,
            artist_credit = EXCLUDED.artist_credit,
            release_year = EXCLUDED.release_year,
            country = EXCLUDED.country,
            label = EXCLUDED.label,
            catalog_number = EXCLUDED.catalog_number,
            discogs_url = EXCLUDED.discogs_url,
            source_fetched_at = NOW(),
            updated_at = NOW()
        RETURNING id, source, discogs_release_id, title, sort_title, artist_credit, release_year,
                  country, label, catalog_number, discogs_url, source_fetched_at;
      `,
      [
        snapshot.discogsReleaseId,
        snapshot.title.trim(),
        sortTitle,
        snapshot.artists
          .map((artist) => artist.trim())
          .filter(Boolean)
          .join(", "),
        snapshot.releaseYear,
        optionalText(snapshot.country),
        optionalText(snapshot.label),
        optionalText(snapshot.catalogNumber),
        snapshot.discogsUrl,
      ],
    );
    const release = releaseResult.rows[0];
    const deletedTracks = await client.query(
      "DELETE FROM music_release_tracks WHERE music_release_id = $1",
      [release.id],
    );
    const trackIds = new Map<number, string>();

    for (const track of snapshot.tracks) {
      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO music_release_tracks (
            music_release_id, sequence_no, position, title, entry_type, duration_seconds
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id;
        `,
        [
          release.id,
          track.sequenceNo,
          track.position.trim(),
          track.title.trim(),
          track.entryType,
          track.durationSeconds,
        ],
      );
      trackIds.set(track.sequenceNo, inserted.rows[0]!.id);
    }

    for (const track of snapshot.tracks) {
      if (track.parentSequenceNo === null) continue;
      await client.query(
        `
          UPDATE music_release_tracks
          SET parent_track_id = $1
          WHERE music_release_id = $2 AND sequence_no = $3;
        `,
        [trackIds.get(track.parentSequenceNo), release.id, track.sequenceNo],
      );
    }

    await client.query("COMMIT");
    return {
      id: release.id,
      discogsReleaseId: Number(release.discogs_release_id),
      title: release.title,
      sortTitle: release.sort_title,
      artistCredit: release.artist_credit,
      releaseYear: release.release_year,
      trackCount: snapshot.tracks.filter((track) => track.entryType === "track").length,
      replacedTrackCount: deletedTracks.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Create a staff-entered release. Manual rows contain no Discogs identifiers or attribution. */
export async function createManualMusicRelease(input: {
  title: unknown;
  sortTitle?: unknown;
  artistCredit?: unknown;
  releaseYear?: unknown;
  tracks?: unknown;
}) {
  if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 500) {
    throw createHttpError(400, 'Field "title" is required and must be at most 500 characters');
  }
  const sortTitle = normalizeSortTitle(input.sortTitle, input.title.trim(), true);
  if (input.artistCredit !== undefined && typeof input.artistCredit !== "string") {
    throw createHttpError(400, 'Field "artistCredit" must be text');
  }
  const artistCredit = typeof input.artistCredit === "string" ? input.artistCredit.trim() : "";
  if (artistCredit.length > 500) {
    throw createHttpError(400, 'Field "artistCredit" must be at most 500 characters');
  }

  let releaseYear: number | null = null;
  if (input.releaseYear !== undefined && input.releaseYear !== null && input.releaseYear !== "") {
    const parsed =
      typeof input.releaseYear === "number"
        ? input.releaseYear
        : typeof input.releaseYear === "string" && /^\d{1,4}$/.test(input.releaseYear)
          ? Number(input.releaseYear)
          : NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9999) {
      throw createHttpError(400, 'Field "releaseYear" must be a year from 1 to 9999');
    }
    releaseYear = parsed;
  }

  if (input.tracks !== undefined && !Array.isArray(input.tracks)) {
    throw createHttpError(400, 'Field "tracks" must be a list of track titles');
  }
  const tracks = (Array.isArray(input.tracks) ? input.tracks : []) as unknown[];
  if (tracks.length > 200)
    throw createHttpError(400, 'Field "tracks" may contain at most 200 entries');
  const trackTitles = tracks.map((track) => {
    if (typeof track !== "string" || !track.trim() || track.trim().length > 500) {
      throw createHttpError(400, "Each manual track title must be 1 to 500 characters");
    }
    return track.trim();
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<PersistedMusicRelease>(
      `
        INSERT INTO music_releases (
          source, title, sort_title, artist_credit, release_year, source_fetched_at, discogs_release_id,
          discogs_url, updated_at
        )
        VALUES ('manual', $1, $2, $3, $4, NULL, NULL, NULL, NOW())
        RETURNING id, source, discogs_release_id, title, sort_title, artist_credit, release_year,
                  country, label, catalog_number, discogs_url, source_fetched_at;
      `,
      [input.title.trim(), sortTitle, artistCredit, releaseYear],
    );
    const release = result.rows[0]!;
    for (const [index, title] of trackTitles.entries()) {
      await client.query(
        `
          INSERT INTO music_release_tracks (music_release_id, sequence_no, position, title)
          VALUES ($1, $2, $3, $4);
        `,
        [release.id, index + 1, String(index + 1), title],
      );
    }
    await client.query("COMMIT");
    return {
      id: release.id,
      source: "manual" as const,
      discogsReleaseId: null,
      discogsUrl: null,
      title: release.title,
      sortTitle: release.sort_title,
      artistCredit: release.artist_credit,
      releaseYear: release.release_year,
      trackCount: trackTitles.length,
      replacedTrackCount: 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function linkCdInventoryItemToMusicRelease(
  inventoryItemId: string,
  musicReleaseId: string,
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const item = await client.query<{ format: string }>(
      "SELECT format FROM inventory_items WHERE id = $1 FOR UPDATE",
      [inventoryItemId],
    );
    if (item.rowCount === 0) throw createHttpError(404, "Inventory item not found");
    if (item.rows[0]!.format !== "cd") {
      throw createHttpError(409, "Only CD inventory items can be linked to a music release");
    }

    const videoLinks = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM inventory_item_titles WHERE inventory_item_id = $1) AS exists",
      [inventoryItemId],
    );
    if (videoLinks.rows[0]!.exists) {
      throw createHttpError(409, "CD inventory items cannot have video title links");
    }

    const releaseExists = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM music_releases WHERE id = $1) AS exists",
      [musicReleaseId],
    );
    if (!releaseExists.rows[0]!.exists) throw createHttpError(404, "Music release not found");

    await client.query(
      `
        INSERT INTO inventory_item_music_releases (inventory_item_id, music_release_id)
        VALUES ($1, $2)
        ON CONFLICT (inventory_item_id) DO UPDATE
        SET music_release_id = EXCLUDED.music_release_id,
            created_at = NOW();
      `,
      [inventoryItemId, musicReleaseId],
    );
    await client.query("COMMIT");
    return { inventoryItemId, musicReleaseId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getMusicReleaseForStaff(musicReleaseId: string) {
  const releaseResult = await pool.query<PersistedMusicRelease>(
    `
      SELECT id, source, discogs_release_id, title, sort_title, artist_credit, release_year,
             country, label, catalog_number, discogs_url, source_fetched_at
      FROM music_releases
      WHERE id = $1;
    `,
    [musicReleaseId],
  );
  const release = releaseResult.rows[0];
  if (!release) throw createHttpError(404, "Music release not found");

  const [tracks, copies] = await Promise.all([
    pool.query<{
      id: string;
      sequence_no: number;
      position: string;
      title: string;
      entry_type: "track" | "heading";
      duration_seconds: number | null;
      parent_track_id: string | null;
    }>(
      `
        SELECT id, sequence_no, position, title, entry_type,
               duration_seconds, parent_track_id
        FROM music_release_tracks
        WHERE music_release_id = $1
        ORDER BY sequence_no ASC;
      `,
      [musicReleaseId],
    ),
    pool.query<{
      id: string;
      inventory_code: string;
      upc_ean: string | null;
      availability: boolean;
      sealed: boolean;
      zone: string;
      section: string;
      row: string;
      location_code: string;
      day_price: string;
      weekend_price: string;
    }>(
      `
        SELECT i.id, i.inventory_code, i.upc_ean, i.availability, i.sealed,
               i.zone, i.section, i.row, i.location_code, i.day_price, i.weekend_price
        FROM inventory_item_music_releases link
        INNER JOIN inventory_items i ON i.id = link.inventory_item_id
        WHERE link.music_release_id = $1 AND i.format = 'cd'
        ORDER BY i.inventory_code ASC;
      `,
      [musicReleaseId],
    ),
  ]);

  return {
    id: release.id,
    source: release.source,
    discogsReleaseId:
      release.discogs_release_id === null ? null : Number(release.discogs_release_id),
    title: release.title,
    sortTitle: release.sort_title,
    artistCredit: release.artist_credit,
    releaseYear: release.release_year,
    country: release.country,
    label: release.label,
    catalogNumber: release.catalog_number,
    discogsUrl: release.discogs_url,
    sourceFetchedAt: release.source_fetched_at,
    tracks: tracks.rows.map((track) => ({
      id: track.id,
      sequenceNo: track.sequence_no,
      position: track.position,
      title: track.title,
      entryType: track.entry_type,
      durationSeconds: track.duration_seconds,
      parentTrackId: track.parent_track_id,
    })),
    inventoryCopies: copies.rows.map((item) => ({
      id: item.id,
      inventoryCode: item.inventory_code,
      upcEan: item.upc_ean,
      availability: item.availability,
      sealed: item.sealed,
      zone: item.zone,
      section: item.section,
      row: item.row,
      locationCode: item.location_code,
      dayPrice: Number(item.day_price),
      weekendPrice: Number(item.weekend_price),
    })),
  };
}

/** Return a persisted Discogs release without refreshing or replacing its local snapshot. */
export async function getStoredMusicReleaseByDiscogsId(discogsReleaseId: unknown) {
  const normalizedId =
    typeof discogsReleaseId === "number"
      ? discogsReleaseId
      : typeof discogsReleaseId === "string" && /^\d+$/.test(discogsReleaseId)
        ? Number(discogsReleaseId)
        : NaN;
  if (!Number.isSafeInteger(normalizedId) || normalizedId < 1) {
    throw createHttpError(400, "Discogs release id must be a positive integer");
  }

  const result = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM music_releases
      WHERE source = 'discogs' AND discogs_release_id = $1;
    `,
    [normalizedId],
  );
  const releaseId = result.rows[0]?.id;
  if (!releaseId) throw createHttpError(404, "Stored Discogs release not found");
  return getMusicReleaseForStaff(releaseId);
}

/** Change only the local sort title; the source snapshot and track list stay untouched. */
export async function updateMusicReleaseSortTitle(musicReleaseId: string, value: unknown) {
  if (typeof value !== "string") {
    throw createHttpError(400, 'Field "sortTitle" must be text');
  }
  const sortTitle = value.trim();
  if (!sortTitle || sortTitle.length > 500) {
    throw createHttpError(400, 'Field "sortTitle" is required and must be at most 500 characters');
  }
  const result = await pool.query<{ id: string }>(
    `UPDATE music_releases SET sort_title = $2 WHERE id = $1 RETURNING id;`,
    [musicReleaseId, sortTitle],
  );
  if (!result.rows[0]) throw createHttpError(404, "Music release not found");
  return getMusicReleaseForStaff(musicReleaseId);
}

export async function searchMusicTracks(searchValue: unknown, limitValue = 50) {
  if (typeof searchValue !== "string") {
    throw createHttpError(400, 'Query parameter "q" is required');
  }
  const query = searchValue.trim();
  if (!query) return [];
  if (query.length > 200) throw createHttpError(400, 'Query parameter "q" is too long');
  const limit = Number.isInteger(limitValue) ? Math.max(1, Math.min(limitValue, 100)) : 50;

  const result = await pool.query<{
    music_release_id: string;
    source: "discogs" | "manual";
    discogs_release_id: string | null;
    release_title: string;
    sort_title: string;
    artist_credit: string;
    release_year: number | null;
    discogs_url: string | null;
    track_id: string;
    sequence_no: number;
    position: string;
    track_title: string;
    duration_seconds: number | null;
    inventory_copies: Array<{
      id: string;
      inventoryCode: string;
      availability: boolean;
      locationCode: string;
    }>;
  }>(
    `
      WITH query AS (
        SELECT plainto_tsquery('simple', $1) AS terms
      ), matching_tracks AS (
        SELECT r.id AS music_release_id, r.source, r.discogs_release_id,
               r.title AS release_title, r.sort_title,
               r.artist_credit, r.release_year, r.discogs_url,
               t.id AS track_id, t.sequence_no, t.position, t.title AS track_title,
               t.duration_seconds,
               ts_rank_cd(to_tsvector('simple'::regconfig, t.title), q.terms) AS title_rank,
               ts_rank_cd(to_tsvector('simple'::regconfig, r.artist_credit), q.terms) AS artist_rank
        FROM music_release_tracks t
        INNER JOIN music_releases r ON r.id = t.music_release_id
        CROSS JOIN query q
        WHERE t.entry_type = 'track'
          AND EXISTS (
            SELECT 1
            FROM inventory_item_music_releases owned_link
            INNER JOIN inventory_items owned_item ON owned_item.id = owned_link.inventory_item_id
            WHERE owned_link.music_release_id = r.id
              AND owned_item.format = 'cd'
          )
          AND (
            to_tsvector('simple'::regconfig, t.title) @@ q.terms
            OR to_tsvector('simple'::regconfig, r.artist_credit) @@ q.terms
          )
        ORDER BY title_rank DESC, artist_rank DESC,
                 r.sort_title ASC, r.title ASC, t.sequence_no ASC
        LIMIT $2
      )
      SELECT track.music_release_id, track.source, track.discogs_release_id,
             track.release_title, track.sort_title, track.artist_credit,
             track.release_year, track.discogs_url, track.track_id,
             track.sequence_no, track.position, track.track_title, track.duration_seconds,
             JSONB_AGG(
               JSONB_BUILD_OBJECT(
                 'id', i.id,
                 'inventoryCode', i.inventory_code,
                 'availability', i.availability,
                 'locationCode', i.location_code
               ) ORDER BY i.inventory_code ASC
             ) AS inventory_copies
      FROM matching_tracks track
      INNER JOIN inventory_item_music_releases link
        ON link.music_release_id = track.music_release_id
      INNER JOIN inventory_items i
        ON i.id = link.inventory_item_id AND i.format = 'cd'
      GROUP BY track.music_release_id, track.source, track.discogs_release_id,
               track.release_title, track.sort_title, track.artist_credit,
               track.release_year, track.discogs_url, track.track_id,
               track.sequence_no, track.position, track.track_title,
               track.duration_seconds, track.title_rank, track.artist_rank
      ORDER BY track.title_rank DESC, track.artist_rank DESC,
               track.sort_title ASC, track.release_title ASC, track.sequence_no ASC
    `,
    [query, limit],
  );

  return result.rows.map((row) => ({
    release: {
      id: row.music_release_id,
      source: row.source,
      discogsReleaseId: row.discogs_release_id === null ? null : Number(row.discogs_release_id),
      title: row.release_title,
      sortTitle: row.sort_title,
      artistCredit: row.artist_credit,
      releaseYear: row.release_year,
      discogsUrl: row.discogs_url,
    },
    track: {
      id: row.track_id,
      sequenceNo: row.sequence_no,
      position: row.position,
      title: row.track_title,
      durationSeconds: row.duration_seconds,
    },
    inventoryCopies: row.inventory_copies,
  }));
}
