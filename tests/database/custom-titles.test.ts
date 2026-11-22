import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCustomTitle } from "@/lib/server/catalog/custom-titles";
import { pool } from "@/lib/server/db";

const testTitle = `Custom Title Test ${randomUUID()}`;

afterAll(async () => {
  await pool.query("DELETE FROM titles WHERE title = $1 AND metadata_source = 'manual'", [
    testTitle,
  ]);
  await pool.end();
});

describe("custom title persistence", () => {
  it("stores a manual title without a TMDB id and returns an existing match on retry", async () => {
    const input = {
      title: testTitle,
      mediaType: "movie",
      releaseDate: "2001-09-23",
      genres: "Drama, Indie",
      director: "Test Director",
    };

    const first = await createCustomTitle(input);
    const second = await createCustomTitle(input);
    const stored = await pool.query<{
      tmdb_id: number | null;
      metadata_source: string;
      sort_title: string;
      genres: string[];
    }>(
      `
        SELECT tmdb_id, metadata_source, sort_title, genres
        FROM titles
        WHERE id = $1;
      `,
      [first.titleId],
    );

    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ titleId: first.titleId, duplicate: true });
    expect(stored.rows[0]).toEqual({
      tmdb_id: null,
      metadata_source: "manual",
      sort_title: testTitle,
      genres: ["Drama", "Indie"],
    });
  });
});
