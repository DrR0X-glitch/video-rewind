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

describe("local PostgreSQL setup", () => {
  it("records the current baseline migration and checksum", async () => {
    const result = await pool!.query<{ migration_id: string; checksum: string }>(`
      SELECT migration_id, checksum
      FROM app_schema_migrations
      ORDER BY migration_id
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.migration_id).toBe("0001_current_schema.sql");
    expect(result.rows[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("contains seeded catalogue, stock, and title-disc links", async () => {
    const result = await pool!.query<{
      title_count: string;
      item_count: string;
      link_count: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM titles) AS title_count,
        (SELECT COUNT(*) FROM inventory_items) AS item_count,
        (SELECT COUNT(*) FROM inventory_item_titles) AS link_count
    `);

    expect(result.rows[0]?.title_count).toBe("10");
    expect(result.rows[0]?.item_count).toBe("10");
    expect(Number(result.rows[0]?.link_count)).toBeGreaterThanOrEqual(10);
  });
});
