import { randomBytes, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool | undefined;

beforeAll(() => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Set DATABASE_URL and prepare the local development database before this suite.",
    );
  }

  const databaseUrl = new URL(connectionString);
  if (
    !["localhost", "127.0.0.1"].includes(databaseUrl.hostname) ||
    databaseUrl.pathname !== "/dvd_store"
  ) {
    throw new Error("Database tests are restricted to local dvd_store.");
  }

  pool = new Pool({ connectionString });
});

afterAll(async () => {
  await pool?.end();
});

describe("CD catalog schema", () => {
  it("adds CD format and indexed release/track tables", async () => {
    const result = await pool!.query<{
      has_cd_format: boolean;
      release_table: boolean;
      track_table: boolean;
      copy_link_table: boolean;
      track_search_index: boolean;
    }>(`
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'inventory_format' AND e.enumlabel = 'cd'
        ) AS has_cd_format,
        to_regclass('public.music_releases') IS NOT NULL AS release_table,
        to_regclass('public.music_release_tracks') IS NOT NULL AS track_table,
        to_regclass('public.inventory_item_music_releases') IS NOT NULL AS copy_link_table,
        to_regclass('public.music_release_tracks_title_search_idx') IS NOT NULL AS track_search_index
    `);

    expect(result.rows[0]).toEqual({
      has_cd_format: true,
      release_table: true,
      track_table: true,
      copy_link_table: true,
      track_search_index: true,
    });
  });

  it("allows manual releases but keeps Discogs identity and attribution paired", async () => {
    const title = `Manual schema check ${randomUUID()}`;
    let releaseId: string | undefined;
    try {
      const result = await pool!.query<{
        id: string;
        source: string;
        discogs_release_id: string | null;
        discogs_url: string | null;
        sort_title: string;
      }>(
        `INSERT INTO music_releases (source, title, sort_title, source_fetched_at) VALUES ('manual', $1, $1, NULL)
         RETURNING id, source, discogs_release_id, discogs_url, sort_title`,
        [title],
      );
      releaseId = result.rows[0]!.id;
      expect(result.rows[0]).toMatchObject({
        source: "manual",
        discogs_release_id: null,
        discogs_url: null,
        sort_title: title,
      });
      await expect(
        pool!.query(
          "INSERT INTO music_releases (source, title, sort_title, source_fetched_at) VALUES ('discogs', $1, $1, NOW())",
          [title],
        ),
      ).rejects.toThrow(/music_releases_source_identity_check/i);
      await expect(
        pool!.query(
          `INSERT INTO music_releases (source, title, sort_title, discogs_release_id, discogs_url, source_fetched_at)
           VALUES ('manual', $1, '', NULL, NULL, NULL)`,
          [title],
        ),
      ).rejects.toThrow(/music_releases_sort_title_check/i);
    } finally {
      if (releaseId) await pool!.query("DELETE FROM music_releases WHERE id = $1", [releaseId]);
    }
  });

  it("stores ordered nested tracks once per release and links one release per CD copy", async () => {
    const releaseId = Math.floor(Date.now() * 1000 + (randomBytes(2).readUInt16BE(0) % 1000));
    const itemCode = `CD-${randomUUID()}`;
    let releaseUuid: string | undefined;
    let inventoryItemId: string | undefined;

    try {
      const release = await pool!.query<{ id: string }>(
        `
          INSERT INTO music_releases (discogs_release_id, title, sort_title, artist_credit, discogs_url)
          VALUES ($1, 'A Sample Album', 'Sample Album', 'A Sample Artist', $2)
          RETURNING id
        `,
        [releaseId, `https://www.discogs.com/release/${releaseId}`],
      );
      releaseUuid = release.rows[0]!.id;

      const parentTrack = await pool!.query<{ id: string }>(
        `
          INSERT INTO music_release_tracks (
            music_release_id, sequence_no, position, title, entry_type, duration_seconds
          )
          VALUES ($1, 1, '1', 'Suite', 'track', 240)
          RETURNING id
        `,
        [releaseUuid],
      );
      await pool!.query(
        `
          INSERT INTO music_release_tracks (
            music_release_id, sequence_no, position, title, parent_track_id
          )
          VALUES ($1, 2, '1a', 'First Movement', $2)
        `,
        [releaseUuid, parentTrack.rows[0]!.id],
      );
      await pool!.query(
        `
          INSERT INTO music_release_tracks (
            music_release_id, sequence_no, position, title, entry_type
          )
          VALUES ($1, 3, '2', 'Disc Two', 'heading')
        `,
        [releaseUuid],
      );

      const inventoryItem = await pool!.query<{ id: string }>(
        `
          INSERT INTO inventory_items (inventory_code, format, zone)
          VALUES ($1, 'cd'::inventory_format, 'S')
          RETURNING id
        `,
        [itemCode],
      );
      inventoryItemId = inventoryItem.rows[0]!.id;
      await pool!.query(
        `
          INSERT INTO inventory_item_music_releases (inventory_item_id, music_release_id)
          VALUES ($1, $2)
        `,
        [inventoryItemId, releaseUuid],
      );

      const rows = await pool!.query<{
        sequence_no: number;
        title: string;
        entry_type: string;
        parent_track_id: string | null;
      }>(
        `
          SELECT sequence_no, title, entry_type, parent_track_id
          FROM music_release_tracks
          WHERE music_release_id = $1
          ORDER BY sequence_no
        `,
        [releaseUuid],
      );
      expect(rows.rows).toEqual([
        {
          sequence_no: 1,
          title: "Suite",
          entry_type: "track",
          parent_track_id: null,
        },
        {
          sequence_no: 2,
          title: "First Movement",
          entry_type: "track",
          parent_track_id: parentTrack.rows[0]!.id,
        },
        {
          sequence_no: 3,
          title: "Disc Two",
          entry_type: "heading",
          parent_track_id: null,
        },
      ]);

      await expect(
        pool!.query(
          `
            INSERT INTO inventory_item_music_releases (inventory_item_id, music_release_id)
            VALUES ($1, $2)
          `,
          [inventoryItemId, releaseUuid],
        ),
      ).rejects.toThrow(/duplicate key/i);

      const linkedCopies = await pool!.query<{ count: string }>(
        `SELECT COUNT(*) FROM inventory_item_music_releases WHERE music_release_id = $1`,
        [releaseUuid],
      );
      expect(linkedCopies.rows[0]?.count).toBe("1");
    } finally {
      if (inventoryItemId) {
        await pool!.query("DELETE FROM inventory_items WHERE id = $1", [inventoryItemId]);
      }
      if (releaseUuid) {
        await pool!.query("DELETE FROM music_releases WHERE id = $1", [releaseUuid]);
      }
    }
  });

  it("prevents music/video links from disagreeing with the inventory format", async () => {
    const releaseId = Math.floor(Date.now() * 1000 + (randomBytes(2).readUInt16BE(0) % 1000));
    const cdCode = `CD-${randomUUID()}`;
    const videoCode = `DVD-${randomUUID()}`;
    let releaseUuid: string | undefined;
    let cdItemId: string | undefined;
    let videoItemId: string | undefined;

    try {
      const release = await pool!.query<{ id: string }>(
        `
          INSERT INTO music_releases (discogs_release_id, title, sort_title, discogs_url)
          VALUES ($1, 'Another Album', 'Another Album', $2)
          RETURNING id
        `,
        [releaseId, `https://www.discogs.com/release/${releaseId}`],
      );
      releaseUuid = release.rows[0]!.id;

      const cd = await pool!.query<{ id: string }>(
        `
          INSERT INTO inventory_items (inventory_code, format, zone)
          VALUES ($1, 'cd'::inventory_format, 'S')
          RETURNING id
        `,
        [cdCode],
      );
      cdItemId = cd.rows[0]!.id;

      const video = await pool!.query<{ id: string }>(
        `
          INSERT INTO inventory_items (inventory_code, format, zone)
          VALUES ($1, 'dvd'::inventory_format, 'S')
          RETURNING id
        `,
        [videoCode],
      );
      videoItemId = video.rows[0]!.id;

      const title = await pool!.query<{ id: string }>("SELECT id FROM titles LIMIT 1");
      expect(title.rows[0]?.id).toBeTruthy();

      await pool!.query(
        `
          INSERT INTO inventory_item_music_releases (inventory_item_id, music_release_id)
          VALUES ($1, $2)
        `,
        [cdItemId, releaseUuid],
      );
      await expect(
        pool!.query(
          `
            INSERT INTO inventory_item_music_releases (inventory_item_id, music_release_id)
            VALUES ($1, $2)
          `,
          [videoItemId, releaseUuid],
        ),
      ).rejects.toThrow(/only be linked to CD/i);
      await expect(
        pool!.query("UPDATE inventory_items SET format = 'dvd' WHERE id = $1", [cdItemId]),
      ).rejects.toThrow(/must remain in CD format/i);
      await expect(
        pool!.query(
          `
            INSERT INTO inventory_item_titles (inventory_item_id, title_id)
            VALUES ($1, $2)
          `,
          [cdItemId, title.rows[0]!.id],
        ),
      ).rejects.toThrow(/only be linked to non-CD/i);

      await pool!.query(
        `
          INSERT INTO inventory_item_titles (inventory_item_id, title_id)
          VALUES ($1, $2)
        `,
        [videoItemId, title.rows[0]!.id],
      );
      await expect(
        pool!.query("UPDATE inventory_items SET format = 'cd' WHERE id = $1", [videoItemId]),
      ).rejects.toThrow(/cannot change to CD format/i);
    } finally {
      if (cdItemId) await pool!.query("DELETE FROM inventory_items WHERE id = $1", [cdItemId]);
      if (videoItemId)
        await pool!.query("DELETE FROM inventory_items WHERE id = $1", [videoItemId]);
      if (releaseUuid) await pool!.query("DELETE FROM music_releases WHERE id = $1", [releaseUuid]);
    }
  });
});
