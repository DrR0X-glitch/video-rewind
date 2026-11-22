import { randomBytes } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createInventoryZone,
  listInventoryZones,
  renameInventoryZone,
  setInventoryZoneActive,
} from "@/lib/server/inventory/zones";

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
    expect(result.rows[0]?.item_count).toBe("10");
    expect(Number(result.rows[0]?.link_count)).toBeGreaterThanOrEqual(10);
    expect(result.rows[0]?.known_zone_count).toBe("3");
    expect(result.rows[0]?.active_known_zone_count).toBe("3");
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
});
