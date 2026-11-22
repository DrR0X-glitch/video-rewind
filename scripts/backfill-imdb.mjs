import pg from "pg";

const { Pool } = pg;
const verbose = process.argv.includes("--verbose");

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

function getTmdbToken() {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim() ?? "";

  if (!token) {
    throw new Error("TMDB_API_READ_ACCESS_TOKEN is required for IMDb backfill");
  }

  return token;
}

function getOmdbApiKey() {
  return process.env.OMDB_API_KEY?.trim() ?? "";
}

async function fetchTmdbImdbId(tmdbId, mediaType, token) {
  const tmdbPath = mediaType === "series" ? "tv" : "movie";
  const response = await fetch(`https://api.themoviedb.org/3/${tmdbPath}/${tmdbId}/external_ids`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return "";
  }

  const payload = await response.json();
  return typeof payload.imdb_id === "string" ? payload.imdb_id.trim() : "";
}

async function fetchOmdbRating(imdbId, apiKey) {
  if (!apiKey || !/^tt\d+$/i.test(imdbId)) {
    return null;
  }

  const response = await fetch(
    `https://www.omdbapi.com/?apikey=${encodeURIComponent(apiKey)}&i=${encodeURIComponent(imdbId)}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  if (
    payload.Response !== "True" ||
    typeof payload.imdbRating !== "string" ||
    payload.imdbRating === "N/A"
  ) {
    return null;
  }

  const rating = Number.parseFloat(payload.imdbRating);
  return Number.isFinite(rating) ? rating : null;
}

async function main() {
  const pool = new Pool(getConnectionConfig());
  const tmdbToken = getTmdbToken();
  const omdbApiKey = getOmdbApiKey();

  let processed = 0;
  let updated = 0;
  let filledImdbId = 0;
  let filledImdbRating = 0;
  let skipped = 0;

  try {
    const result = await pool.query(`
      SELECT id, tmdb_id, media_type, title, imdb_id, imdb_rating
      FROM titles
      WHERE imdb_id IS NULL OR imdb_rating IS NULL
      ORDER BY sort_title ASC, title ASC
    `);

    const total = result.rowCount ?? 0;

    console.log(`Found ${total} title(s) missing IMDb metadata`);

    for (const row of result.rows) {
      processed += 1;
      console.log(`[${processed}/${total}] ${row.title}`);

      const existingImdbId = typeof row.imdb_id === "string" ? row.imdb_id.trim() : "";
      const needsImdbId = !existingImdbId;
      const needsRating = row.imdb_rating === null;

      let imdbIdToStore = existingImdbId;
      let imdbRatingToStore = null;

      if (needsImdbId) {
        if (verbose) {
          console.log(`  TMDB external_ids lookup for tmdb_id=${row.tmdb_id} (${row.media_type})`);
        }
        imdbIdToStore = await fetchTmdbImdbId(row.tmdb_id, row.media_type, tmdbToken);
      }

      if (needsRating && imdbIdToStore && omdbApiKey) {
        if (verbose) {
          console.log(`  OMDb rating lookup for imdb_id=${imdbIdToStore}`);
        }
        imdbRatingToStore = await fetchOmdbRating(imdbIdToStore, omdbApiKey);
      }

      if ((!needsImdbId || !imdbIdToStore) && (!needsRating || imdbRatingToStore === null)) {
        skipped += 1;
        if (verbose) {
          console.log("  Skipped: nothing missing could be backfilled");
        }
        continue;
      }

      const updateResult = await pool.query(
        `
          UPDATE titles
          SET
            imdb_id = COALESCE(imdb_id, $2),
            imdb_rating = COALESCE(imdb_rating, $3),
            updated_at = NOW()
          WHERE id = $1
            AND (imdb_id IS NULL OR imdb_rating IS NULL)
          RETURNING imdb_id, imdb_rating;
        `,
        [row.id, imdbIdToStore || null, imdbRatingToStore],
      );

      if ((updateResult.rowCount ?? 0) > 0) {
        updated += 1;

        if (needsImdbId && imdbIdToStore) {
          filledImdbId += 1;
        }

        if (needsRating && imdbRatingToStore !== null) {
          filledImdbRating += 1;
        }

        console.log(
          `  Updated imdb_id=${imdbIdToStore || "unchanged"} | imdb_rating=${imdbRatingToStore ?? "unchanged"}`,
        );
      } else {
        skipped += 1;
        if (verbose) {
          console.log("  Skipped: row no longer needed updating");
        }
      }
    }

    console.log("");
    console.log(`Processed: ${processed}`);
    console.log(`Updated rows: ${updated}`);
    console.log(`IMDb ids filled: ${filledImdbId}`);
    console.log(`IMDb ratings filled: ${filledImdbRating}`);
    console.log(`Skipped: ${skipped}`);

    if (!omdbApiKey) {
      console.log("OMDB_API_KEY not configured, so only missing imdb_id values were backfilled.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
