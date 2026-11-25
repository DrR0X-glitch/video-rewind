import fs from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;

const verbose = process.argv.includes("--verbose");
const csvPath = process.argv.slice(2).find((argument) => !argument.startsWith("--"));

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
    throw new Error("TMDB_API_READ_ACCESS_TOKEN is required for CSV stock import");
  }

  return token;
}

function parseCsv(text) {
  const rows = [];
  let currentField = "";
  let currentRow = [];
  let index = 0;
  let inQuotes = false;

  while (index < text.length) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          currentField += '"';
          index += 2;
          continue;
        }

        inQuotes = false;
        index += 1;
        continue;
      }

      currentField += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      currentRow.push(currentField);
      currentField = "";
      index += 1;
      continue;
    }

    if (char === "\n") {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentField = "";
      currentRow = [];
      index += 1;
      continue;
    }

    if (char === "\r") {
      index += 1;
      continue;
    }

    currentField += char;
    index += 1;
  }

  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((field) => field.trim() !== ""));
}

function normalizeHeader(value) {
  return value.trim().toLowerCase();
}

function getColumnIndex(headerMap, ...names) {
  for (const name of names) {
    const match = headerMap.get(normalizeHeader(name));
    if (match !== undefined) {
      return match;
    }
  }

  return -1;
}

function getCell(row, index) {
  return index >= 0 ? (row[index] ?? "") : "";
}

function getSuggestedSortTitle(title) {
  return title.replace(/^(a|an|the)\s+/i, "").trim() || title.trim();
}

function parseTmdbInput(input) {
  const trimmed = input.trim();

  const movieMatch = trimmed.match(/themoviedb\.org\/movie\/(\d+)/i);
  if (movieMatch) {
    return { tmdbId: movieMatch[1], mediaType: "movie" };
  }

  const tvMatch = trimmed.match(/themoviedb\.org\/tv\/(\d+)/i);
  if (tvMatch) {
    return { tmdbId: tvMatch[1], mediaType: "series" };
  }

  throw new Error(`Invalid TMDB URL: ${input}`);
}

function normalizeZone(rawValue) {
  const normalized = rawValue.trim().toLowerCase();

  switch (normalized) {
    case "wall":
    case "w":
      return "W";
    case "display":
    case "d":
      return "D";
    case "shed":
    case "s":
      return "S";
    default:
      throw new Error(`Invalid zone value: ${rawValue || "(blank)"}`);
  }
}

function normalizeSection(rawValue) {
  const normalized = rawValue.trim().toUpperCase();

  if (!normalized) {
    throw new Error('Field "Section" is required');
  }

  if (normalized.length < 1 || normalized.length > 2) {
    throw new Error('Field "Section" must be 1 or 2 characters');
  }

  return normalized;
}

function normalizeFormat(rawValue) {
  const normalized = rawValue.trim().toLowerCase().replace(/\s+/g, " ");

  switch (normalized) {
    case "dvd":
      return "dvd";
    case "blu-ray":
    case "blu ray":
    case "bluray":
      return "blu-ray";
    case "4k uhd":
    case "4k-uhd":
    case "uhd":
      return "4k-uhd";
    default:
      throw new Error(`Invalid format value: ${rawValue || "(blank)"}`);
  }
}

function normalizeCopies(rawValue) {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return 1;
  }

  const parsed = Number.parseInt(trimmed, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid Copies value: ${rawValue}`);
  }

  return parsed;
}

function normalizeSealed(rawValue) {
  const normalized = rawValue.trim().toLowerCase();
  return normalized === "sealed" || normalized === "true" || normalized === "yes";
}

function buildLocationCode(zone, section, row) {
  return `${zone}/${section}${row}`;
}

async function fetchTmdbTitleDraft(tmdbUrl, token) {
  const parsed = parseTmdbInput(tmdbUrl);
  const tmdbPath = parsed.mediaType === "series" ? "tv" : "movie";

  const response = await fetch(
    `https://api.themoviedb.org/3/${tmdbPath}/${parsed.tmdbId}?append_to_response=credits,external_ids`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    throw new Error(`TMDB title not found for ${tmdbUrl}`);
  }

  if (!response.ok) {
    throw new Error(`TMDB request failed for ${tmdbUrl} (${response.status})`);
  }

  const payload = await response.json();
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const normalizedTitle = title || name;

  if (!normalizedTitle) {
    throw new Error(`TMDB title response did not contain a title for ${tmdbUrl}`);
  }

  return {
    tmdbId: String(payload.id),
    imdbId:
      typeof payload.external_ids?.imdb_id === "string" ? payload.external_ids.imdb_id.trim() : "",
    mediaType: parsed.mediaType,
    title: normalizedTitle,
    sortTitle: getSuggestedSortTitle(normalizedTitle),
    overview: typeof payload.overview === "string" ? payload.overview.trim() : "",
    releaseDate:
      typeof payload.release_date === "string"
        ? payload.release_date
        : typeof payload.first_air_date === "string"
          ? payload.first_air_date
          : "",
    posterPath: typeof payload.poster_path === "string" ? payload.poster_path : null,
    genres: Array.isArray(payload.genres)
      ? payload.genres
          .map((genre) => (typeof genre?.name === "string" ? genre.name.trim() : ""))
          .filter(Boolean)
      : [],
    director:
      parsed.mediaType === "series"
        ? Array.isArray(payload.created_by)
          ? (payload.created_by.find((entry) => typeof entry?.name === "string")?.name ?? "").trim()
          : ""
        : Array.isArray(payload.credits?.crew)
          ? (
              payload.credits.crew.find(
                (entry) => entry?.job === "Director" && typeof entry?.name === "string",
              )?.name ?? ""
            ).trim()
          : "",
    cast: Array.isArray(payload.credits?.cast)
      ? payload.credits.cast
          .slice(0, 6)
          .map((entry) => ({
            name: typeof entry?.name === "string" ? entry.name.trim() : "",
            character: typeof entry?.character === "string" ? entry.character.trim() : "",
          }))
          .filter((entry) => entry.name)
      : [],
  };
}

async function findExistingTitle(client, tmdbId, mediaType) {
  const result = await client.query(
    `
      SELECT id, title
      FROM titles
      WHERE tmdb_id = $1
        AND media_type = $2::title_media_type
      LIMIT 1
    `,
    [Number.parseInt(tmdbId, 10), mediaType],
  );

  return result.rows[0] ?? null;
}

async function ensureTitle(client, tmdbUrl, tmdbToken) {
  const parsed = parseTmdbInput(tmdbUrl);
  const existing = await findExistingTitle(client, parsed.tmdbId, parsed.mediaType);

  if (existing) {
    return {
      id: existing.id,
      title: existing.title,
      created: false,
    };
  }

  const draft = await fetchTmdbTitleDraft(tmdbUrl, tmdbToken);
  if (!draft.releaseDate || !/^\d{4}/.test(draft.releaseDate)) {
    throw new Error(`A release year is required for TMDB title ${draft.title} (${tmdbUrl})`);
  }
  const insertResult = await client.query(
    `
      INSERT INTO titles (
        tmdb_id,
        imdb_id,
        media_type,
        title,
        sort_title,
        overview,
        release_year,
        release_date,
        poster_path,
        genres,
        director,
        cast_members
      )
      VALUES (
        $1,
        $2,
        $3::title_media_type,
        $4,
        $5,
        $6,
        $7,
        NULLIF($8, '')::date,
        $9,
        $10::text[],
        $11,
        $12::jsonb
      )
      ON CONFLICT (tmdb_id, media_type) DO NOTHING
      RETURNING id, title
    `,
    [
      Number.parseInt(draft.tmdbId, 10),
      draft.imdbId || null,
      draft.mediaType,
      draft.title,
      draft.sortTitle || draft.title,
      draft.overview,
      draft.releaseDate ? Number(draft.releaseDate.slice(0, 4)) : null,
      draft.releaseDate,
      draft.posterPath,
      draft.genres,
      draft.director,
      JSON.stringify(draft.cast),
    ],
  );

  if ((insertResult.rowCount ?? 0) > 0) {
    return {
      id: insertResult.rows[0].id,
      title: insertResult.rows[0].title,
      created: true,
    };
  }

  const fallback = await findExistingTitle(client, draft.tmdbId, draft.mediaType);

  if (!fallback) {
    throw new Error(`Failed to create or locate title for ${tmdbUrl}`);
  }

  return {
    id: fallback.id,
    title: fallback.title,
    created: false,
  };
}

async function allocateInventoryCode(client) {
  const result = await client.query(`
    SELECT LPAD(candidate.code::text, 6, '0') AS inventory_code
    FROM generate_series(1, 999999) AS candidate(code)
    LEFT JOIN inventory_items i
      ON i.inventory_code = LPAD(candidate.code::text, 6, '0')
    WHERE i.inventory_code IS NULL
    ORDER BY candidate.code ASC
    LIMIT 1
  `);

  const inventoryCode = result.rows[0]?.inventory_code;

  if (!inventoryCode) {
    throw new Error("No disc codes are available");
  }

  return inventoryCode;
}

async function createInventoryItem(client, input) {
  const inventoryCode = await allocateInventoryCode(client);
  const row = "00";
  const locationCode = buildLocationCode(input.zone, input.section, row);

  const inventoryResult = await client.query(
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
        day_price,
        weekend_price,
        late_class
      )
      VALUES (
        $1,
        TRUE,
        FALSE,
        $2,
        $3::inventory_format,
        $4,
        $5,
        $6,
        $7,
        $8,
        0,
        0,
        0
      )
      RETURNING id, inventory_code
    `,
    [
      inventoryCode,
      input.sealed,
      input.format,
      input.zone,
      input.section,
      row,
      locationCode,
      input.notes,
    ],
  );

  const inventoryItemId = inventoryResult.rows[0].id;

  await client.query(
    `
      INSERT INTO inventory_item_titles (
        inventory_item_id,
        title_id,
        position
      )
      VALUES ($1, $2, 1)
    `,
    [inventoryItemId, input.titleId],
  );

  return inventoryResult.rows[0].inventory_code;
}

async function main() {
  if (!csvPath) {
    throw new Error("Usage: pnpm import:stock -- <path-to-csv> [--verbose]");
  }

  const csvText = await fs.readFile(csvPath, "utf8");
  const parsedRows = parseCsv(csvText);

  if (parsedRows.length < 2) {
    throw new Error("CSV file must include a header row and at least one data row");
  }

  const [headerRow, ...dataRows] = parsedRows;
  const headerMap = new Map(headerRow.map((header, index) => [normalizeHeader(header), index]));

  const tmdbIndex = getColumnIndex(headerMap, "TMDB");
  const zoneIndex = getColumnIndex(headerMap, "Wall", "Zone");
  const sectionIndex = getColumnIndex(headerMap, "Section");
  const formatIndex = getColumnIndex(headerMap, "Format");
  const copiesIndex = getColumnIndex(headerMap, "Copies");
  const sealedIndex = getColumnIndex(headerMap, "Sealed");
  const notesIndex = getColumnIndex(headerMap, "Notes");

  const requiredColumns = [
    ["TMDB", tmdbIndex],
    ["Wall", zoneIndex],
    ["Section", sectionIndex],
    ["Format", formatIndex],
    ["Copies", copiesIndex],
    ["Sealed", sealedIndex],
    ["Notes", notesIndex],
  ];

  const missingColumns = requiredColumns.filter(([, index]) => index < 0).map(([name]) => name);

  if (missingColumns.length > 0) {
    throw new Error(`CSV is missing required column(s): ${missingColumns.join(", ")}`);
  }

  const pool = new Pool(getConnectionConfig());
  const tmdbToken = getTmdbToken();

  let processedRows = 0;
  let createdTitles = 0;
  let reusedTitles = 0;
  let createdDiscs = 0;

  try {
    console.log(`Found ${dataRows.length} CSV row(s) to import`);

    for (const [index, row] of dataRows.entries()) {
      const lineNumber = index + 2;
      const tmdbUrl = getCell(row, tmdbIndex).trim();

      if (!tmdbUrl) {
        if (verbose) {
          console.log(
            `[${index + 1}/${dataRows.length}] Skipped blank TMDB URL on line ${lineNumber}`,
          );
        }
        continue;
      }

      const zone = normalizeZone(getCell(row, zoneIndex));
      const section = normalizeSection(getCell(row, sectionIndex));
      const format = normalizeFormat(getCell(row, formatIndex));
      const copies = normalizeCopies(getCell(row, copiesIndex));
      const sealed = normalizeSealed(getCell(row, sealedIndex));
      const notes = getCell(row, notesIndex).trim();

      processedRows += 1;
      console.log(`[${processedRows}/${dataRows.length}] ${tmdbUrl}`);

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const titleResult = await ensureTitle(client, tmdbUrl, tmdbToken);

        if (titleResult.created) {
          createdTitles += 1;
        } else {
          reusedTitles += 1;
        }

        if (verbose) {
          console.log(
            `  Title: ${titleResult.title} (${titleResult.created ? "created" : "existing"}) | ${copies} cop${copies === 1 ? "y" : "ies"}`,
          );
        }

        for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
          const inventoryCode = await createInventoryItem(client, {
            titleId: titleResult.id,
            zone,
            section,
            format,
            sealed,
            notes,
          });

          createdDiscs += 1;

          if (verbose) {
            console.log(`  Disc ${copyIndex + 1}/${copies}: ${inventoryCode} ${zone}/${section}00`);
          }
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(
          `Import failed on CSV line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        client.release();
      }
    }

    console.log("");
    console.log(`Imported rows: ${processedRows}`);
    console.log(`Created titles: ${createdTitles}`);
    console.log(`Existing titles reused: ${reusedTitles}`);
    console.log(`Created unreviewed discs: ${createdDiscs}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
