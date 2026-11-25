import pg from "pg";

const { Pool } = pg;

function getConnectionConfig() {
  const configuredUrl = process.env.DATABASE_URL;

  if (configuredUrl) {
    try {
      new URL(configuredUrl);
    } catch {
      throw new Error(
        "Invalid DATABASE_URL. Use a full Postgres URL like postgres://user:password@localhost:5432/dbname",
      );
    }

    return { connectionString: configuredUrl };
  }

  return {
    host: process.env.PGHOST ?? "localhost",
    port: Number.parseInt(process.env.PGPORT ?? "5432", 10),
    user: process.env.PGUSER ?? "dvd",
    password: process.env.PGPASSWORD ?? "dvd",
    database: process.env.PGDATABASE ?? "dvd_store",
  };
}

function assertSafeSeedTarget() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run development seed data with NODE_ENV=production.");
  }

  const configuredUrl = process.env.DATABASE_URL;

  let hostname = process.env.PGHOST ?? "localhost";
  let databaseName = process.env.PGDATABASE ?? "dvd_store";
  if (configuredUrl) {
    const databaseUrl = new URL(configuredUrl);
    hostname = databaseUrl.hostname;
    databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
  }

  const allowedHosts = new Set(["localhost", "127.0.0.1", "postgres"]);
  const allowedDatabases = new Set(["dvd_store"]);

  if (!allowedHosts.has(hostname) || !allowedDatabases.has(databaseName)) {
    throw new Error(
      `Refusing to seed ${hostname}/${databaseName}. Development seeds are restricted to the local dvd_store database.`,
    );
  }
}

function normalizeSortTitle(title) {
  return title.replace(/^(a|an|the)\s+/i, "").trim() || title.trim();
}

function buildLocationCode(zone, section, row) {
  return `${zone}/${section}${row}`;
}

function cast(name, character) {
  return { name, character };
}

const seedTitles = [
  {
    tmdbId: 603,
    imdbId: "tt0133093",
    imdbRating: 8.7,
    mediaType: "movie",
    title: "The Matrix",
    releaseDate: "1999-03-31",
    posterPath: null,
    genres: ["Action", "Science Fiction"],
    director: "Lana Wachowski, Lilly Wachowski",
    overview: "A hacker learns the world is a simulation and joins the resistance.",
    cast: [
      cast("Keanu Reeves", "Neo"),
      cast("Laurence Fishburne", "Morpheus"),
      cast("Carrie-Anne Moss", "Trinity"),
    ],
    featured: true,
    hideFromHomepage: false,
  },
  {
    tmdbId: 604,
    imdbId: "tt0234215",
    imdbRating: 7.2,
    mediaType: "movie",
    title: "The Matrix Reloaded",
    releaseDate: "2003-05-15",
    posterPath: null,
    genres: ["Action", "Science Fiction"],
    director: "Lana Wachowski, Lilly Wachowski",
    overview: "Neo and the crew race to stop a machine uprising.",
    cast: [
      cast("Keanu Reeves", "Neo"),
      cast("Laurence Fishburne", "Morpheus"),
      cast("Carrie-Anne Moss", "Trinity"),
    ],
    featured: false,
    hideFromHomepage: false,
  },
  {
    tmdbId: 605,
    imdbId: "tt0242653",
    imdbRating: 6.8,
    mediaType: "movie",
    title: "The Matrix Revolutions",
    releaseDate: "2003-11-05",
    posterPath: null,
    genres: ["Action", "Science Fiction"],
    director: "Lana Wachowski, Lilly Wachowski",
    overview: "The war for Zion reaches its final stage.",
    cast: [
      cast("Keanu Reeves", "Neo"),
      cast("Laurence Fishburne", "Morpheus"),
      cast("Carrie-Anne Moss", "Trinity"),
    ],
    featured: false,
    hideFromHomepage: false,
  },
  {
    tmdbId: 348,
    imdbId: "tt0078748",
    imdbRating: 8.5,
    mediaType: "movie",
    title: "Alien",
    releaseDate: "1979-05-25",
    posterPath: null,
    genres: ["Horror", "Science Fiction"],
    director: "Ridley Scott",
    overview: "A commercial crew encounters a hostile lifeform on a remote ship.",
    cast: [
      cast("Sigourney Weaver", "Ripley"),
      cast("Tom Skerritt", "Dallas"),
      cast("Veronica Cartwright", "Lambert"),
    ],
    featured: true,
    hideFromHomepage: false,
  },
  {
    tmdbId: 679,
    imdbId: "tt0089243",
    imdbRating: 8.4,
    mediaType: "movie",
    title: "Aliens",
    releaseDate: "1986-07-18",
    posterPath: null,
    genres: ["Action", "Horror", "Science Fiction"],
    director: "James Cameron",
    overview: "Ripley returns to a colony where the alien threat has spread.",
    cast: [
      cast("Sigourney Weaver", "Ripley"),
      cast("Michael Biehn", "Corporal Hicks"),
      cast("Carrie Henn", "Newt"),
    ],
    featured: false,
    hideFromHomepage: false,
  },
  {
    tmdbId: 78,
    imdbId: "tt0083658",
    imdbRating: 8.1,
    mediaType: "movie",
    title: "Blade Runner",
    releaseDate: "1982-06-25",
    posterPath: null,
    genres: ["Science Fiction", "Thriller"],
    director: "Ridley Scott",
    overview: "A blade runner hunts rogue replicants in a rain-soaked future city.",
    cast: [
      cast("Harrison Ford", "Deckard"),
      cast("Rutger Hauer", "Roy Batty"),
      cast("Sean Young", "Rachael"),
    ],
    featured: true,
    hideFromHomepage: false,
  },
  {
    tmdbId: 1396,
    imdbId: "tt0903747",
    imdbRating: 9.5,
    mediaType: "series",
    title: "Breaking Bad",
    releaseDate: "2008-01-20",
    posterPath: null,
    genres: ["Crime", "Drama"],
    director: "Vince Gilligan",
    overview: "A chemistry teacher turns to the drug trade after a terminal diagnosis.",
    cast: [
      cast("Bryan Cranston", "Walter White"),
      cast("Aaron Paul", "Jesse Pinkman"),
      cast("Anna Gunn", "Skyler White"),
    ],
    featured: true,
    hideFromHomepage: false,
  },
  {
    tmdbId: 2316,
    imdbId: "tt0386676",
    imdbRating: 8.9,
    mediaType: "series",
    title: "The Office",
    releaseDate: "2005-03-24",
    posterPath: null,
    genres: ["Comedy"],
    director: "Greg Daniels",
    overview: "A mockumentary about the daily life of a small office.",
    cast: [
      cast("Steve Carell", "Michael Scott"),
      cast("Rainn Wilson", "Dwight Schrute"),
      cast("Jenna Fischer", "Pam Beesly"),
    ],
    featured: false,
    hideFromHomepage: false,
  },
  {
    tmdbId: 212,
    imdbId: "tt0084787",
    imdbRating: 8.2,
    mediaType: "movie",
    title: "The Thing",
    releaseDate: "1982-06-25",
    posterPath: null,
    genres: ["Horror", "Science Fiction"],
    director: "John Carpenter",
    overview: "A remote research team is hunted by a shape-shifting organism.",
    cast: [
      cast("Kurt Russell", "MacReady"),
      cast("Wilford Brimley", "Blair"),
      cast("Keith David", "Childs"),
    ],
    featured: false,
    hideFromHomepage: true,
  },
  {
    tmdbId: 811,
    imdbId: "tt0116282",
    imdbRating: 8.1,
    mediaType: "movie",
    title: "Fargo",
    releaseDate: "1996-03-08",
    posterPath: null,
    genres: ["Crime", "Drama", "Thriller"],
    director: "Joel Coen, Ethan Coen",
    overview: "A botched crime in Minnesota spirals out of control.",
    cast: [
      cast("Frances McDormand", "Marge Gunderson"),
      cast("William H. Macy", "Jerry Lundegaard"),
      cast("Steve Buscemi", "Carl Showalter"),
    ],
    featured: false,
    hideFromHomepage: false,
  },
];

const seedCollections = [
  {
    tmdbCollectionId: 2344,
    name: "The Matrix Collection",
    overview: "The full Matrix trilogy for catalog and collection testing.",
    posterPath: null,
    titles: [603, 604, 605],
  },
  {
    tmdbCollectionId: 8091,
    name: "Alien Collection",
    overview: "A compact set for Alien and Aliens.",
    posterPath: null,
    titles: [348, 679],
  },
];

const seedInventoryItems = [
  {
    inventoryCode: "000101",
    availability: true,
    reviewed: true,
    sealed: false,
    format: "4k-uhd",
    zone: "W",
    section: "A",
    row: "1",
    notes: "Featured wall copy",
    lastRentedAt: null,
    dayPrice: 5,
    weekendPrice: 8,
    lateClass: 1,
    titleLinks: [{ tmdbId: 603 }],
  },
  {
    inventoryCode: "000102",
    availability: false,
    reviewed: true,
    sealed: false,
    format: "blu-ray",
    zone: "W",
    section: "A",
    row: "2",
    notes: "Checked out",
    lastRentedAt: "2026-07-17T10:00:00.000Z",
    dayPrice: 4,
    weekendPrice: 7,
    lateClass: 1,
    titleLinks: [{ tmdbId: 603 }],
  },
  {
    inventoryCode: "000103",
    availability: true,
    reviewed: true,
    sealed: true,
    format: "blu-ray",
    zone: "W",
    section: "A",
    row: "3",
    notes: "Sealed spare copy",
    lastRentedAt: null,
    dayPrice: 4,
    weekendPrice: 7,
    lateClass: 1,
    titleLinks: [{ tmdbId: 604 }],
  },
  {
    inventoryCode: "000104",
    availability: true,
    reviewed: true,
    sealed: false,
    format: "dvd",
    zone: "D",
    section: "B",
    row: "1",
    notes: "Double feature disc",
    lastRentedAt: null,
    dayPrice: 3,
    weekendPrice: 5,
    lateClass: 0,
    titleLinks: [{ tmdbId: 348 }, { tmdbId: 679 }],
  },
  {
    inventoryCode: "000105",
    availability: true,
    reviewed: true,
    sealed: false,
    format: "blu-ray",
    zone: "D",
    section: "B",
    row: "2",
    notes: "Recently returned",
    lastRentedAt: "2026-07-18T15:30:00.000Z",
    dayPrice: 4,
    weekendPrice: 7,
    lateClass: 1,
    titleLinks: [{ tmdbId: 78 }],
  },
  {
    inventoryCode: "000106",
    availability: true,
    reviewed: true,
    sealed: false,
    format: "blu-ray",
    zone: "S",
    section: "C",
    row: "1",
    notes: "Seasons 1-2",
    lastRentedAt: null,
    dayPrice: 4,
    weekendPrice: 7,
    lateClass: 0,
    titleLinks: [{ tmdbId: 1396, seasonStart: 1, seasonEnd: 2 }],
  },
  {
    inventoryCode: "000107",
    availability: true,
    reviewed: false,
    sealed: false,
    format: "blu-ray",
    zone: "S",
    section: "C",
    row: "2",
    notes: "Needs approval",
    lastRentedAt: null,
    dayPrice: 4,
    weekendPrice: 7,
    lateClass: 0,
    titleLinks: [{ tmdbId: 2316, seasonStart: 1, seasonEnd: 1, episodeStart: 1, episodeEnd: 4 }],
  },
  {
    inventoryCode: "000108",
    availability: false,
    reviewed: true,
    sealed: false,
    format: "dvd",
    zone: "W",
    section: "D",
    row: "1",
    notes: "Cracked case",
    lastRentedAt: "2026-07-16T09:15:00.000Z",
    dayPrice: 3,
    weekendPrice: 5,
    lateClass: 0,
    titleLinks: [{ tmdbId: 212 }],
  },
  {
    inventoryCode: "000109",
    availability: true,
    reviewed: true,
    sealed: false,
    format: "dvd",
    zone: "D",
    section: "B",
    row: "3",
    notes: "Shelf-ready",
    lastRentedAt: "2026-07-15T11:45:00.000Z",
    dayPrice: 3,
    weekendPrice: 5,
    lateClass: 0,
    titleLinks: [{ tmdbId: 811 }],
  },
  {
    inventoryCode: "000110",
    availability: true,
    reviewed: true,
    sealed: false,
    format: "4k-uhd",
    zone: "W",
    section: "A",
    row: "4",
    notes: "Trilogy shelf copy",
    lastRentedAt: null,
    dayPrice: 5,
    weekendPrice: 8,
    lateClass: 1,
    titleLinks: [{ tmdbId: 605 }],
  },
];

async function main() {
  assertSafeSeedTarget();
  const pool = new Pool(getConnectionConfig());

  try {
    const client = await pool.connect();
    const titleIdsByTmdbId = new Map();

    try {
      await client.query("BEGIN");

      await client.query(`
        TRUNCATE TABLE
          inventory_item_titles,
          collection_titles,
          inventory_items,
          collections,
          titles
        RESTART IDENTITY CASCADE;
      `);

      for (const title of seedTitles) {
        const result = await client.query(
          `
            INSERT INTO titles (
              tmdb_id,
              imdb_id,
              imdb_rating,
              media_type,
              title,
              sort_title,
              overview,
              release_year,
              release_date,
              poster_path,
              genres,
              director,
              cast_members,
              featured,
              hide_from_homepage
            )
            VALUES ($1, $2, $3, $4::title_media_type, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
            RETURNING id;
          `,
          [
            title.tmdbId,
            title.imdbId,
            title.imdbRating,
            title.mediaType,
            title.title,
            normalizeSortTitle(title.title),
            title.overview,
            Number(title.releaseDate.slice(0, 4)),
            title.releaseDate,
            title.posterPath,
            title.genres,
            title.director,
            JSON.stringify(title.cast),
            title.featured,
            title.hideFromHomepage,
          ],
        );

        titleIdsByTmdbId.set(title.tmdbId, result.rows[0].id);
      }

      for (const collection of seedCollections) {
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
            RETURNING id;
          `,
          [
            collection.tmdbCollectionId,
            collection.name,
            normalizeSortTitle(collection.name),
            seedTitles.find((title) => title.tmdbId === collection.titles[0])?.title ??
              collection.name,
            normalizeSortTitle(
              seedTitles.find((title) => title.tmdbId === collection.titles[0])?.title ??
                collection.name,
            ),
            seedTitles.find((title) => title.tmdbId === collection.titles[0])?.releaseDate ?? null,
            collection.overview,
            collection.posterPath,
          ],
        );

        for (const [index, tmdbId] of collection.titles.entries()) {
          const titleId = titleIdsByTmdbId.get(tmdbId);

          if (!titleId) {
            continue;
          }

          await client.query(
            `
              INSERT INTO collection_titles (collection_id, title_id, position)
              VALUES ($1, $2, $3)
              ON CONFLICT (collection_id, title_id)
              DO UPDATE SET position = EXCLUDED.position;
            `,
            [collectionResult.rows[0].id, titleId, index + 1],
          );
        }
      }

      for (const item of seedInventoryItems) {
        const locationCode = buildLocationCode(item.zone, item.section, item.row);
        const itemResult = await client.query(
          `
            INSERT INTO inventory_items (
              inventory_code,
              availability,
              reviewed,
              sealed,
              format,
              zone,
              section,
              row,
              location_code,
              notes,
              last_rented_at,
              day_price,
              weekend_price,
              late_class
            )
            VALUES ($1, $2, $3, $4, $5::inventory_format, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id;
          `,
          [
            item.inventoryCode,
            item.availability,
            item.reviewed,
            item.sealed,
            item.format,
            item.zone,
            item.section,
            item.row,
            locationCode,
            item.notes,
            item.lastRentedAt,
            item.dayPrice,
            item.weekendPrice,
            item.lateClass,
          ],
        );

        for (const [index, link] of item.titleLinks.entries()) {
          const titleId = titleIdsByTmdbId.get(link.tmdbId);

          if (!titleId) {
            continue;
          }

          await client.query(
            `
              INSERT INTO inventory_item_titles (
                inventory_item_id,
                title_id,
                season_start,
                season_end,
                episode_start,
                episode_end,
                position
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7);
            `,
            [
              itemResult.rows[0].id,
              titleId,
              link.seasonStart ?? null,
              link.seasonEnd ?? null,
              link.episodeStart ?? null,
              link.episodeEnd ?? null,
              index + 1,
            ],
          );
        }
      }

      const maxInventoryCode = Math.max(
        ...seedInventoryItems.map((item) => Number.parseInt(item.inventoryCode, 10)),
      );

      await client.query(`SELECT setval('inventory_code_seq', $1::bigint, true)`, [
        maxInventoryCode,
      ]);

      await client.query("COMMIT");
      console.log(
        `Seeded ${seedTitles.length} titles and ${seedInventoryItems.length} inventory items`,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
