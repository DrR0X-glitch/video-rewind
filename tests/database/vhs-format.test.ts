import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createInventoryItemInDatabase } from "@/lib/server/inventory/items";
import { GET as getMovieRoute } from "@/app/api/movies/[id]/route";
import { pool } from "@/lib/server/db";
import {
  getMovieFromDatabase,
  getPublicMovieDetailFromDatabase,
  listBrowseMoviesFromDatabase,
} from "@/lib/server/store";

afterAll(async () => {
  await pool.end();
});

describe("staff-only VHS inventory", () => {
  it("keeps VHS titles and copies in staff inventory but out of public results", async () => {
    const name = `VHS visibility ${randomUUID()}`;
    const inserted = await pool.query<{ id: string }>(
      `
        INSERT INTO titles (tmdb_id, media_type, title, sort_title, release_year, metadata_source)
        VALUES (NULL, 'movie', $1, $1, 1984, 'manual')
        RETURNING id;
      `,
      [name],
    );
    const titleId = inserted.rows[0]!.id;
    const inventoryIds: string[] = [];

    try {
      const items = await Promise.all(
        Array.from({ length: 2 }, () =>
          createInventoryItemInDatabase({
            title_ids: titleId,
            format: "vhs",
            zone: "S",
            section: "V",
          }),
        ),
      );
      inventoryIds.push(...items.map((item) => item.id));
      expect(new Set(items.map((item) => item.inventoryCode)).size).toBe(2);
      await pool.query("UPDATE inventory_items SET reviewed = TRUE WHERE id = ANY($1::uuid[])", [
        inventoryIds,
      ]);

      const staffTitle = await getMovieFromDatabase(titleId);
      expect(staffTitle.inventoryItems.map((copy) => copy.format)).toContain("vhs");
      await expect(getPublicMovieDetailFromDatabase(titleId)).rejects.toMatchObject({
        statusCode: 404,
      });
      const apiResponse = await getMovieRoute(new Request("http://localhost/api/movies/test"), {
        params: Promise.resolve({ id: titleId }),
      });
      expect(apiResponse.status).toBe(404);
      await expect(listBrowseMoviesFromDatabase({ search: name })).resolves.toEqual([]);
    } finally {
      if (inventoryIds.length > 0) {
        await pool.query("DELETE FROM inventory_items WHERE id = ANY($1::uuid[])", [inventoryIds]);
      }
      await pool.query("DELETE FROM titles WHERE id = $1", [titleId]);
    }
  });
});
