import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createInventoryZone,
  deleteEmptyInventoryZone,
  listInventoryZones,
  renameInventoryZone,
  setInventoryZoneActive,
} from "@/lib/server/inventory/zones";
import {
  createInventoryItemInDatabase,
  updateInventoryItemInDatabase,
} from "@/lib/server/inventory/items";

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

describe("local PostgreSQL setup", () => {
  it("records the current baseline and zone migration checksums", async () => {
    const result = await pool!.query<{ migration_id: string; checksum: string }>(`
      SELECT migration_id, checksum
      FROM app_schema_migrations
      ORDER BY migration_id
    `);

    expect(result.rows.map((row) => row.migration_id)).toEqual([
      "0001_current_schema.sql",
      "0002_inventory_zones.sql",
      "0003_custom_titles.sql",
      "0004_inventory_upc_ean.sql",
      "0005_required_title_year.sql",
      "0006_vhs_inventory_format.sql",
      "0007_cd_catalog.sql",
      "0008_manual_music_releases.sql",
      "0009_music_release_sort_title.sql",
      "0010_cd_review_bypass.sql",
    ]);
    expect(result.rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
  });

  it("contains seeded catalogue, stock, and title-disc links", async () => {
    const result = await pool!.query<{
      title_count: string;
      item_count: string;
      link_count: string;
      known_zone_count: string;
      active_known_zone_count: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM titles WHERE tmdb_id IS NOT NULL) AS title_count,
        (SELECT COUNT(*) FROM inventory_items) AS item_count,
        (SELECT COUNT(*) FROM inventory_item_titles) AS link_count,
        (SELECT COUNT(*) FROM inventory_zones WHERE code IN ('S', 'D', 'W')) AS known_zone_count,
        (SELECT COUNT(*) FROM inventory_zones WHERE code IN ('S', 'D', 'W') AND is_active = TRUE) AS active_known_zone_count
    `);

    expect(result.rows[0]?.title_count).toBe("10");
    expect(Number(result.rows[0]?.item_count)).toBeGreaterThanOrEqual(10);
    expect(Number(result.rows[0]?.link_count)).toBeGreaterThanOrEqual(10);
    expect(result.rows[0]?.known_zone_count).toBe("3");
    expect(result.rows[0]?.active_known_zone_count).toBe("3");
  });

  it("marks existing CD copies reviewed without changing movie copies", async () => {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TEMP TABLE inventory_items (format TEXT, reviewed BOOLEAN);
        INSERT INTO inventory_items (format, reviewed) VALUES ('cd', FALSE), ('dvd', FALSE);
      `);
      const migration = await readFile(
        new URL("../../db/migrations/0010_cd_review_bypass.sql", import.meta.url),
        "utf8",
      );
      await client.query(migration);
      const result = await client.query<{ format: string; reviewed: boolean }>(
        "SELECT format, reviewed FROM inventory_items ORDER BY format",
      );
      expect(result.rows).toEqual([
        { format: "cd", reviewed: true },
        { format: "dvd", reviewed: false },
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("requires a release year and a non-empty sort title", async () => {
    const result = await pool!.query<{
      year_nullable: string;
      year_count: string;
      invalid_titles: string;
    }>(`
      SELECT
        (SELECT is_nullable FROM information_schema.columns WHERE table_name = 'titles' AND column_name = 'release_year') AS year_nullable,
        (SELECT COUNT(*) FROM titles WHERE release_year IS NULL) AS year_count,
        (SELECT COUNT(*) FROM titles WHERE BTRIM(sort_title) = '') AS invalid_titles
    `);
    expect(result.rows[0]).toEqual({ year_nullable: "NO", year_count: "0", invalid_titles: "0" });
  });

  it("allows the explicit year-one placeholder for legacy titles without a date", async () => {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ release_year: number; release_date: string }>(
        `
          INSERT INTO titles (
            tmdb_id, media_type, title, sort_title, release_year, release_date, metadata_source
          )
          VALUES (NULL, 'movie', 'Legacy year placeholder', 'Legacy year placeholder', 1, DATE '0001-01-01', 'manual')
          RETURNING release_year, release_date::TEXT;
        `,
      );
      expect(result.rows[0]).toEqual({ release_year: 1, release_date: "0001-01-01" });
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  it("backfills legacy title years from dates and marks missing dates with year one", async () => {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TEMP TABLE titles (
          title TEXT NOT NULL,
          sort_title TEXT NOT NULL,
          release_date DATE
        );
        INSERT INTO titles (title, sort_title, release_date)
        VALUES ('Known year', '', DATE '1982-06-25'), ('Unknown year', 'Unknown year', NULL);
      `);
      const migration = await readFile(
        new URL("../../db/migrations/0005_required_title_year.sql", import.meta.url),
        "utf8",
      );
      await client.query(migration);
      const rows = await client.query<{
        title: string;
        sort_title: string;
        release_year: number;
        release_date: string;
      }>(`
        SELECT title, sort_title, release_year, release_date::TEXT
        FROM titles
        ORDER BY title;
      `);
      expect(rows.rows).toEqual([
        {
          title: "Known year",
          sort_title: "Known year",
          release_year: 1982,
          release_date: "1982-06-25",
        },
        {
          title: "Unknown year",
          sort_title: "Unknown year",
          release_year: 1,
          release_date: "0001-01-01",
        },
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("stores UPC/EAN values on inventory copies without requiring uniqueness", async () => {
    const result = await pool!.query<{ is_nullable: string }>(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'inventory_items' AND column_name = 'upc_ean'
    `);
    expect(result.rows[0]?.is_nullable).toBe("YES");

    const titleResult = await pool!.query<{ id: string }>("SELECT id FROM titles LIMIT 1");
    const titleId = titleResult.rows[0]?.id;
    expect(titleId).toBeTruthy();
    const barcode = "012345678905";
    const createdIds: string[] = [];
    const section = randomBytes(1).toString("hex").slice(0, 2).toUpperCase();

    try {
      const first = await createInventoryItemInDatabase({
        title_ids: titleId,
        format: "dvd",
        zone: "S",
        section,
        upc_ean: barcode,
      });
      createdIds.push(first.id);
      const second = await createInventoryItemInDatabase({
        title_ids: titleId,
        format: "dvd",
        zone: "S",
        section,
        upc_ean: barcode,
      });
      createdIds.push(second.id);

      const copies = await pool!.query<{ count: string }>(
        "SELECT COUNT(*) FROM inventory_items WHERE id = ANY($1::uuid[]) AND upc_ean = $2",
        [createdIds, barcode],
      );
      expect(copies.rows[0]?.count).toBe("2");

      await updateInventoryItemInDatabase(first.id, { upc_ean: "4006381333931" });
      await updateInventoryItemInDatabase(first.id, { upc_ean: "" });
      const cleared = await pool!.query<{ upc_ean: string | null }>(
        "SELECT upc_ean FROM inventory_items WHERE id = $1",
        [first.id],
      );
      expect(cleared.rows[0]?.upc_ean).toBeNull();
    } finally {
      await pool!.query("DELETE FROM inventory_items WHERE id = ANY($1::uuid[])", [createdIds]);
    }
  });

  it("creates, renames, deactivates, and reactivates a zone", async () => {
    const code = `Q${randomBytes(2).toString("hex").slice(0, 3).toUpperCase()}`;
    try {
      const created = await createInventoryZone({ code, label: "Quarantine" });
      expect(created).toMatchObject({ code, label: "Quarantine", isActive: true });

      const renamed = await renameInventoryZone(code, "Archive");
      expect(renamed.label).toBe("Archive");

      const deactivated = await setInventoryZoneActive(code, false);
      expect(deactivated.isActive).toBe(false);
      const activeZones = await listInventoryZones({ activeOnly: true });
      expect(activeZones.some((zone) => zone.code === code)).toBe(false);
      const allZones = await listInventoryZones();
      expect(allZones.find((zone) => zone.code === code)).toMatchObject({
        code,
        label: "Archive",
        isActive: false,
      });

      const reactivated = await setInventoryZoneActive(code, true);
      expect(reactivated.isActive).toBe(true);
    } finally {
      await pool!.query("DELETE FROM inventory_zones WHERE code = $1", [code]);
    }
  });

  it("permanently deletes an empty zone and refuses one containing discs", async () => {
    const code = `X${randomBytes(2).toString("hex").slice(0, 3).toUpperCase()}`;
    let itemId: string | undefined;
    try {
      await createInventoryZone({ code, label: "Temporary" });
      const title = await pool!.query<{ id: string }>("SELECT id FROM titles LIMIT 1");
      const item = await createInventoryItemInDatabase({
        title_ids: title.rows[0]!.id,
        format: "dvd",
        zone: code,
        section: "T",
      });
      itemId = item.id;
      await expect(deleteEmptyInventoryZone(code)).rejects.toThrow(/Move all discs out/);
      await pool!.query("UPDATE inventory_items SET zone = 'S' WHERE id = $1", [itemId]);
      await expect(deleteEmptyInventoryZone(code)).resolves.toEqual({ code });
      const deleted = await pool!.query("SELECT 1 FROM inventory_zones WHERE code = $1", [code]);
      expect(deleted.rowCount).toBe(0);
    } finally {
      if (itemId) await pool!.query("DELETE FROM inventory_items WHERE id = $1", [itemId]);
      await pool!.query("DELETE FROM inventory_zones WHERE code = $1", [code]);
    }
  });
});
