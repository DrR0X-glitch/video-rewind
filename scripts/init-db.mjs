import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Pool } = pg;

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(currentDirectory, "../db/schema.sql");

function getConnectionConfig() {
  if (process.env.DATABASE_URL) {
    try {
      new URL(process.env.DATABASE_URL);
    } catch {
      throw new Error(
        "Invalid DATABASE_URL. Use a full Postgres URL like postgres://user:password@localhost:5432/dbname",
      );
    }

    return {
      connectionString: process.env.DATABASE_URL,
    };
  }

  return {
    host: process.env.PGHOST ?? "localhost",
    port: Number.parseInt(process.env.PGPORT ?? "5432", 10),
    user: process.env.PGUSER ?? "dvd",
    password: process.env.PGPASSWORD ?? "dvd",
    database: process.env.PGDATABASE ?? "dvd_store",
  };
}

async function main() {
  const pool = new Pool(getConnectionConfig());

  try {
    const schema = await fs.readFile(schemaPath, "utf8");
    await pool.query(schema);
    console.log("Database schema initialized");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
