import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Pool } = pg;
const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(rootDirectory, "db", "migrations");
const baselineMigrationId = "0001_current_schema.sql";
const migrationTableName = "app_schema_migrations";
const migrationLock = [724061, 1];
const isBaselineMode = process.argv.includes("--baseline");
const isDevelopmentResetMode = process.argv.includes("--dev-reset");

const requiredBaselineColumns = {
  titles: [
    "id",
    "tmdb_id",
    "imdb_id",
    "imdb_rating",
    "media_type",
    "title",
    "sort_title",
    "overview",
    "release_date",
    "poster_path",
    "genres",
    "director",
    "cast_members",
    "featured",
    "hide_from_homepage",
    "created_at",
    "updated_at",
  ],
  inventory_items: [
    "id",
    "inventory_code",
    "availability",
    "reviewed",
    "sealed",
    "format",
    "zone",
    "section",
    "row",
    "location_code",
    "notes",
    "last_rented_at",
    "day_price",
    "weekend_price",
    "late_class",
    "created_at",
    "updated_at",
  ],
  inventory_item_titles: [
    "inventory_item_id",
    "title_id",
    "season_start",
    "season_end",
    "episode_start",
    "episode_end",
    "position",
  ],
  collections: [
    "id",
    "tmdb_collection_id",
    "name",
    "sort_name",
    "anchor_title",
    "anchor_sort_title",
    "anchor_release_date",
    "overview",
    "poster_path",
    "created_at",
    "updated_at",
  ],
  collection_titles: ["collection_id", "title_id", "position"],
};

function getConnectionConfig() {
  const configuredUrl = process.env.DATABASE_URL;

  if (configuredUrl) {
    let databaseUrl;

    try {
      databaseUrl = new URL(configuredUrl);
    } catch {
      throw new Error("Invalid DATABASE_URL. Use a full postgres:// URL.");
    }

    if (process.env.NODE_ENV === "production" && !databaseUrl.password) {
      throw new Error("DATABASE_URL must include an explicit password in production.");
    }

    return { connectionString: configuredUrl };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Set DATABASE_URL explicitly in production; local fallback credentials are disabled.",
    );
  }

  return {
    host: process.env.PGHOST ?? "localhost",
    port: Number.parseInt(process.env.PGPORT ?? "5432", 10),
    user: process.env.PGUSER ?? "dvd",
    password: process.env.PGPASSWORD ?? "dvd",
    database: process.env.PGDATABASE ?? "dvd_store",
  };
}

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

async function readMigrations() {
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && /^\d{4}_[a-z0-9_-]+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (names.length === 0) {
    throw new Error(`No migration files found in ${migrationsDirectory}`);
  }

  if (new Set(names.map((name) => name.slice(0, 4))).size !== names.length) {
    throw new Error("Migration prefixes must be unique.");
  }

  if (names[0] !== baselineMigrationId) {
    throw new Error(`The first migration must be ${baselineMigrationId}.`);
  }

  return Promise.all(
    names.map(async (id) => {
      const sql = await fs.readFile(path.join(migrationsDirectory, id), "utf8");
      return { id, sql, checksum: checksum(sql) };
    }),
  );
}

async function migrationTableExists(client) {
  const result = await client.query("SELECT to_regclass($1) IS NOT NULL AS exists", [
    `public.${migrationTableName}`,
  ]);
  return result.rows[0]?.exists === true;
}

async function createMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.${migrationTableName} (
      migration_id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function hasApplicationTables(client) {
  const result = await client.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> $1
    ) AS exists
  `,
    [migrationTableName],
  );
  return result.rows[0]?.exists === true;
}

async function assertBaselineSchema(client) {
  const missing = [];

  for (const [table, expectedColumns] of Object.entries(requiredBaselineColumns)) {
    const result = await client.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `,
      [table],
    );
    const presentColumns = new Set(result.rows.map((row) => row.column_name));
    const missingColumns = expectedColumns.filter((column) => !presentColumns.has(column));

    if (missingColumns.length > 0) {
      missing.push(`${table}: ${missingColumns.join(", ")}`);
    }
  }

  const requiredTypes = await client.query(`
    SELECT typname
    FROM pg_type
    WHERE typname IN ('title_media_type', 'inventory_format')
  `);
  const presentTypes = new Set(requiredTypes.rows.map((row) => row.typname));
  for (const type of ["title_media_type", "inventory_format"]) {
    if (!presentTypes.has(type)) {
      missing.push(`PostgreSQL type: ${type}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Database does not match the current schema baseline. Missing: ${missing.join("; ")}`,
    );
  }
}

async function baselineExistingDatabase(client, baselineMigration) {
  await assertBaselineSchema(client);
  await createMigrationTable(client);

  const applied = await client.query(
    `SELECT checksum FROM public.${migrationTableName} WHERE migration_id = $1`,
    [baselineMigration.id],
  );
  if (applied.rows.length > 0) {
    if (applied.rows[0].checksum !== baselineMigration.checksum) {
      throw new Error(
        "The existing baseline checksum does not match the checked-in migration file.",
      );
    }
    console.log("Current schema baseline is already recorded.");
    return;
  }

  const otherApplied = await client.query(
    `SELECT migration_id FROM public.${migrationTableName} LIMIT 1`,
  );
  if (otherApplied.rows.length > 0) {
    throw new Error("Cannot baseline a database that already has a different migration history.");
  }

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO public.${migrationTableName} (migration_id, checksum) VALUES ($1, $2)`,
      [baselineMigration.id, baselineMigration.checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  console.log("Recorded the existing schema as the current baseline; no schema SQL was re-run.");
}

async function runMigrations(client, migrations) {
  const appliedResult = await client.query(
    `SELECT migration_id, checksum FROM public.${migrationTableName} ORDER BY migration_id`,
  );
  const applied = new Map(appliedResult.rows.map((row) => [row.migration_id, row.checksum]));
  const knownIds = new Set(migrations.map((migration) => migration.id));

  for (const migrationId of applied.keys()) {
    if (!knownIds.has(migrationId)) {
      throw new Error(
        `Database records unknown migration ${migrationId}; restore its migration file.`,
      );
    }
  }

  for (const migration of migrations) {
    const previousChecksum = applied.get(migration.id);
    if (previousChecksum) {
      if (previousChecksum !== migration.checksum) {
        throw new Error(
          `Applied migration ${migration.id} has changed; add a new migration instead.`,
        );
      }
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO public.${migrationTableName} (migration_id, checksum) VALUES ($1, $2)`,
        [migration.id, migration.checksum],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${migration.id} failed: ${error.message}`, { cause: error });
    }

    console.log(`Applied ${migration.id}`);
  }

  if (applied.size === migrations.length) {
    console.log("Database schema is up to date.");
  }
}

async function main() {
  const pool = new Pool(getConnectionConfig());
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", migrationLock);
    const migrations = await readMigrations();
    const tableExists = await migrationTableExists(client);
    const existingApplicationTables = await hasApplicationTables(client);

    if (isBaselineMode) {
      if (migrations[0] === undefined) {
        throw new Error("The baseline migration file is missing.");
      }
      await baselineExistingDatabase(client, migrations[0]);
      await runMigrations(client, migrations);
      return;
    }

    if (!tableExists && existingApplicationTables) {
      if (!isDevelopmentResetMode) {
        throw new Error(
          `This database already has application tables but no migration history. Back it up and verify it, then run "pnpm db:migrate:baseline" to record the current schema without re-running it.`,
        );
      }

      const baseline = migrations[0];
      if (baseline === undefined) {
        throw new Error("The baseline migration file is missing.");
      }
      await baselineExistingDatabase(client, baseline);
    }

    if (tableExists && existingApplicationTables) {
      const baseline = await client.query(
        `SELECT 1 FROM public.${migrationTableName} WHERE migration_id = $1`,
        [baselineMigrationId],
      );
      const migrationCount = await client.query(
        `SELECT COUNT(*)::INTEGER AS count FROM public.${migrationTableName}`,
      );
      if (baseline.rows.length === 0) {
        const hasMigrationHistory = migrationCount.rows[0]?.count !== 0;
        if (!isDevelopmentResetMode || hasMigrationHistory) {
          const detail = hasMigrationHistory
            ? "a migration history without the current baseline"
            : "an empty migration history";
          throw new Error(
            `This database has application tables but ${detail}. Back it up and verify it, then run "pnpm db:migrate:baseline".`,
          );
        }

        const baselineMigration = migrations[0];
        if (baselineMigration === undefined) {
          throw new Error("The baseline migration file is missing.");
        }
        await baselineExistingDatabase(client, baselineMigration);
      }
    }

    await createMigrationTable(client);
    await runMigrations(client, migrations);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", migrationLock);
    } finally {
      client.release();
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
