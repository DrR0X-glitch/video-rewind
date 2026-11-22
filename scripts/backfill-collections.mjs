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
    throw new Error("TMDB_API_READ_ACCESS_TOKEN is required for collection backfill");
  }

  return token;
}

function getSuggestedSortTitle(title) {
  return title.replace(/^(a|an|the)\s+/i, "").trim() || title.trim();
}

function compareCollectionParts(a, b) {
  const aTime = a.release_date ? new Date(a.release_date).getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.release_date ? new Date(b.release_date).getTime() : Number.MAX_SAFE_INTEGER;

  if (aTime !== bTime) {
    return aTime - bTime;
  }

  return (a.title ?? "").localeCompare(b.title ?? "");
}

async function fetchTmdbMovie(tmdbId, token) {
  const response = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function fetchTmdbCollection(collectionId, token) {
  const response = await fetch(`https://api.themoviedb.org/3/collection/${collectionId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function upsertCollectionForTitle(client, collection) {
  const anchorTitle = collection.titles[0];
  const collectionResult = await client.query(
    `
      INSERT INTO collections (
        tmdb_collection_id,
        name,
        sort_name,
        anchor_title,
        anchor_sort_title,
        anchor_release_date,
        overview,
        poster_path
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (tmdb_collection_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        sort_name = EXCLUDED.sort_name,
        anchor_title = EXCLUDED.anchor_title,
        anchor_sort_title = EXCLUDED.anchor_sort_title,
        anchor_release_date = COALESCE(EXCLUDED.anchor_release_date, collections.anchor_release_date),
        overview = EXCLUDED.overview,
        poster_path = COALESCE(EXCLUDED.poster_path, collections.poster_path),
        updated_at = NOW()
      RETURNING id;
    `,
    [
      Number.parseInt(collection.tmdbId, 10),
      collection.name,
      getSuggestedSortTitle(collection.name),
      anchorTitle?.title ?? collection.name,
      anchorTitle
        ? getSuggestedSortTitle(anchorTitle.title)
        : getSuggestedSortTitle(collection.name),
      anchorTitle?.releaseDate || null,
      collection.overview,
      collection.posterPath,
    ],
  );

  const collectionId = collectionResult.rows[0].id;
  const tmdbIds = collection.titles
    .map((title) => Number.parseInt(title.tmdbId, 10))
    .filter((tmdbMovieId) => !Number.isNaN(tmdbMovieId));

  if (tmdbIds.length === 0) {
    return { linkedCount: 0 };
  }

  const existingTitles = await client.query(
    `
      SELECT id, tmdb_id
      FROM titles
      WHERE media_type = 'movie'
        AND tmdb_id = ANY($1::int[]);
    `,
    [tmdbIds],
  );

  const existingByTmdbId = new Map(existingTitles.rows.map((row) => [row.tmdb_id, row.id]));
  const linkedTitleIds = [];

  for (const [index, title] of collection.titles.entries()) {
    const titleId = existingByTmdbId.get(Number.parseInt(title.tmdbId, 10));

    if (!titleId) {
      continue;
    }

    linkedTitleIds.push(titleId);

    await client.query(
      `
        INSERT INTO collection_titles (collection_id, title_id, position)
        VALUES ($1, $2, $3)
        ON CONFLICT (collection_id, title_id)
        DO UPDATE SET position = EXCLUDED.position;
      `,
      [collectionId, titleId, index + 1],
    );
  }

  if (linkedTitleIds.length > 0) {
    await client.query(
      `
        DELETE FROM collection_titles
        WHERE collection_id = $1
          AND title_id <> ALL($2::uuid[]);
      `,
      [collectionId, linkedTitleIds],
    );
  }

  return { linkedCount: linkedTitleIds.length };
}

async function main() {
  const pool = new Pool(getConnectionConfig());
  const tmdbToken = getTmdbToken();

  let processed = 0;
  let updated = 0;
  let linkedTitles = 0;
  let skipped = 0;

  try {
    const result = await pool.query(`
      SELECT t.id, t.tmdb_id, t.title
      FROM titles t
      LEFT JOIN collection_titles ct ON ct.title_id = t.id
      WHERE t.media_type = 'movie'
        AND t.tmdb_id IS NOT NULL
        AND ct.title_id IS NULL
      ORDER BY t.sort_title ASC, t.title ASC
    `);

    const total = result.rowCount ?? 0;
    console.log(`Found ${total} movie title(s) missing collection links`);

    for (const row of result.rows) {
      processed += 1;
      console.log(`[${processed}/${total}] ${row.title}`);

      const movie = await fetchTmdbMovie(row.tmdb_id, tmdbToken);

      if (!movie?.belongs_to_collection?.id) {
        skipped += 1;
        if (verbose) {
          console.log("  Skipped: TMDB title is not in a collection");
        }
        continue;
      }

      const collectionDetails = await fetchTmdbCollection(
        movie.belongs_to_collection.id,
        tmdbToken,
      );

      if (!collectionDetails?.id || !collectionDetails?.name) {
        skipped += 1;
        if (verbose) {
          console.log("  Skipped: TMDB collection lookup failed");
        }
        continue;
      }

      const collection = {
        tmdbId: String(collectionDetails.id),
        name: collectionDetails.name,
        overview: typeof collectionDetails.overview === "string" ? collectionDetails.overview : "",
        posterPath:
          typeof collectionDetails.poster_path === "string" ? collectionDetails.poster_path : null,
        titles: Array.isArray(collectionDetails.parts)
          ? collectionDetails.parts
              .slice()
              .sort(compareCollectionParts)
              .map((part) => ({
                tmdbId: String(part.id),
                title: typeof part.title === "string" ? part.title : "",
                releaseDate: typeof part.release_date === "string" ? part.release_date : "",
              }))
          : [],
      };

      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const backfillResult = await upsertCollectionForTitle(client, collection);
        await client.query("COMMIT");
        updated += 1;
        linkedTitles += backfillResult.linkedCount;

        if (verbose) {
          console.log(
            `  Linked ${backfillResult.linkedCount} local title(s) into ${collection.name}`,
          );
        }
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    console.log("");
    console.log(`Processed: ${processed}`);
    console.log(`Updated collections: ${updated}`);
    console.log(`Linked titles: ${linkedTitles}`);
    console.log(`Skipped: ${skipped}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
