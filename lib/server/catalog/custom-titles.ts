import "server-only";

import { normalizeCustomTitleInput, type CustomTitleInput } from "@/lib/catalog/custom-title-input";
import { pool } from "@/lib/server/db";

export async function createCustomTitle(input: CustomTitleInput) {
  const title = normalizeCustomTitleInput(input);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `${title.mediaType}:${title.title.toLocaleLowerCase()}`,
    ]);

    const duplicate = await client.query<{ id: string }>(
      `
        SELECT id
        FROM titles
        WHERE LOWER(BTRIM(title)) = LOWER($1)
          AND media_type = $2::title_media_type
          AND ($3::date IS NULL OR release_date = $3::date)
        ORDER BY release_date NULLS FIRST, created_at ASC
        LIMIT 1;
      `,
      [title.title, title.mediaType, title.releaseDate],
    );

    if (duplicate.rows[0]) {
      await client.query("COMMIT");
      return { titleId: duplicate.rows[0].id, duplicate: true };
    }

    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO titles (
          tmdb_id,
          media_type,
          title,
          sort_title,
          overview,
          release_date,
          genres,
          director,
          cast_members,
          metadata_source
        )
        VALUES (NULL, $1::title_media_type, $2, $3, $4, $5::date, $6::text[], $7, '[]'::jsonb, 'manual')
        RETURNING id;
      `,
      [
        title.mediaType,
        title.title,
        title.sortTitle,
        title.overview,
        title.releaseDate,
        title.genres,
        title.director,
      ],
    );

    await client.query("COMMIT");
    return { titleId: inserted.rows[0]!.id, duplicate: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
