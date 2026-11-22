import "server-only";

import { Pool } from "pg";

declare global {
  var __dvdStorePool: Pool | undefined;
}

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

  const hasExplicitPostgresConfig = Boolean(
    process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD,
  );

  if (process.env.NODE_ENV === "production" && !hasExplicitPostgresConfig) {
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return {
        connectionString: "postgres://build:build@127.0.0.1:1/build-only",
      };
    }

    throw new Error("Set DATABASE_URL or explicit PG* variables in production.");
  }

  return {
    host: process.env.PGHOST ?? "localhost",
    port: Number.parseInt(process.env.PGPORT ?? "5432", 10),
    user: process.env.PGUSER ?? "dvd",
    password: process.env.PGPASSWORD ?? "dvd",
    database: process.env.PGDATABASE ?? "dvd_store",
  };
}

function createPool() {
  return new Pool(getConnectionConfig());
}

export const pool = global.__dvdStorePool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  global.__dvdStorePool = pool;
}
