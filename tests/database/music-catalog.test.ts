import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import {
  createManualMusicRelease,
  getMusicReleaseForStaff,
  getStoredMusicReleaseByDiscogsId,
  linkCdInventoryItemToMusicRelease,
  searchMusicTracks,
  storeDiscogsMusicRelease,
  updateMusicReleaseSortTitle,
} from "@/lib/server/catalog/music-releases";
import {
  createInventoryItemInDatabase,
  updateInventoryItemInDatabase,
} from "@/lib/server/inventory/items";
import { pool } from "@/lib/server/db";
import {
  getAlphabeticalStockSectionsFromDatabase,
  getInventoryItemById,
  listStockDiscsFromDatabase,
} from "@/lib/server/store";

afterAll(async () => {
  await pool.end();
});

function releaseSnapshot(discogsReleaseId: number) {
  return {
    discogsReleaseId,
    title: `The CD Test Release ${discogsReleaseId}`,
    artists: ["Test Artist"],
    releaseYear: 2005,
    country: "US",
    label: "Test Label",
    catalogNumber: "TEST-001",
    discogsUrl: `https://www.discogs.com/release/${discogsReleaseId}`,
    tracks: [
      {
        sequenceNo: 1,
        position: "1-1",
        title: `Night Drive ${discogsReleaseId}`,
        entryType: "track" as const,
        durationSeconds: 205,
        parentSequenceNo: null,
      },
      {
        sequenceNo: 2,
        position: "1-2",
        title: "Second Movement",
        entryType: "heading" as const,
        durationSeconds: null,
        parentSequenceNo: null,
      },
      {
        sequenceNo: 3,
        position: "1-2-1",
        title: "After Midnight",
        entryType: "track" as const,
        durationSeconds: 191,
        parentSequenceNo: 2,
      },
    ],
  };
}

function uniqueDiscogsReleaseId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

describe("music catalog persistence and lookup", () => {
  it("requires a sort title for manual releases", async () => {
    await expect(createManualMusicRelease({ title: "An Album", tracks: [] })).rejects.toMatchObject(
      {
        statusCode: 400,
        message: 'Field "sortTitle" is required',
      },
    );
  });

  it("creates manual releases without Discogs identifiers or attribution", async () => {
    const title = `Manual Album ${randomUUID()}`;
    const release = await createManualMusicRelease({
      title,
      sortTitle: "Manual Album Sort",
      artistCredit: "Local Artist",
      releaseYear: "1998",
      tracks: ["First Song", "Second Song"],
    });

    try {
      const detail = await getMusicReleaseForStaff(release.id);
      expect(release).toMatchObject({
        source: "manual",
        discogsReleaseId: null,
        discogsUrl: null,
        sortTitle: "Manual Album Sort",
        trackCount: 2,
      });
      expect(detail).toMatchObject({
        source: "manual",
        discogsReleaseId: null,
        discogsUrl: null,
        title,
        sortTitle: "Manual Album Sort",
        artistCredit: "Local Artist",
        releaseYear: 1998,
      });
      expect(detail.tracks.map((track) => [track.sequenceNo, track.position, track.title])).toEqual(
        [
          [1, "1", "First Song"],
          [2, "2", "Second Song"],
        ],
      );
      expect(
        await searchMusicTracks("First Song").then((matches) =>
          matches.some((match) => match.release.id === release.id),
        ),
      ).toBe(false);
    } finally {
      await pool.query("DELETE FROM music_releases WHERE id = $1", [release.id]);
    }
  });

  it("stores one release snapshot, replaces its tracks, and preserves nested order", async () => {
    const discogsReleaseId = uniqueDiscogsReleaseId();
    const first = await storeDiscogsMusicRelease(releaseSnapshot(discogsReleaseId));

    try {
      const initialDetail = await getMusicReleaseForStaff(first.id);
      expect(first.sortTitle).toBe(`CD Test Release ${discogsReleaseId}`);
      expect(initialDetail.sortTitle).toBe(first.sortTitle);
      expect(initialDetail.tracks[2]!.parentTrackId).toBe(initialDetail.tracks[1]!.id);
      const locallyStored = await getStoredMusicReleaseByDiscogsId(discogsReleaseId);
      expect(locallyStored.id).toBe(first.id);
      expect(locallyStored.sortTitle).toBe(first.sortTitle);
      expect(locallyStored.tracks).toHaveLength(3);

      const tracksBeforeSortEdit = locallyStored.tracks.map((track) => ({
        id: track.id,
        title: track.title,
      }));
      const edited = await updateMusicReleaseSortTitle(first.id, "  Edited Sort Title  ");
      expect(edited.sortTitle).toBe("Edited Sort Title");
      expect(edited.tracks.map((track) => ({ id: track.id, title: track.title }))).toEqual(
        tracksBeforeSortEdit,
      );
      await expect(updateMusicReleaseSortTitle(first.id, "  ")).rejects.toMatchObject({
        statusCode: 400,
      });

      const changedSnapshot = releaseSnapshot(discogsReleaseId);
      changedSnapshot.title = "Updated CD Test Release";
      changedSnapshot.tracks[0]!.title = `Updated Night Drive ${discogsReleaseId}`;
      changedSnapshot.tracks.pop();
      const updated = await storeDiscogsMusicRelease(changedSnapshot, "A Custom Sort Title");
      const detail = await getMusicReleaseForStaff(first.id);
      const count = await pool.query<{ release_count: number }>(
        "SELECT COUNT(*)::integer AS release_count FROM music_releases WHERE discogs_release_id = $1",
        [discogsReleaseId],
      );

      expect(updated.id).toBe(first.id);
      expect(updated.replacedTrackCount).toBe(3);
      expect(count.rows[0]!.release_count).toBe(1);
      expect(detail.title).toBe("Updated CD Test Release");
      expect(detail.sortTitle).toBe("A Custom Sort Title");
      expect((await getStoredMusicReleaseByDiscogsId(discogsReleaseId)).sortTitle).toBe(
        "A Custom Sort Title",
      );
      expect(detail.tracks.map((track) => track.title)).toEqual([
        `Updated Night Drive ${discogsReleaseId}`,
        "Second Movement",
      ]);
      expect(detail.tracks[0]!.parentTrackId).toBeNull();
    } finally {
      await pool.query("DELETE FROM music_releases WHERE discogs_release_id = $1", [
        discogsReleaseId,
      ]);
    }
  });

  it("creates multiple CD copies linked to one release and searches actual tracks with copy locations", async () => {
    const discogsReleaseId = uniqueDiscogsReleaseId();
    const release = await storeDiscogsMusicRelease(releaseSnapshot(discogsReleaseId));
    const inventoryIds: string[] = [];

    try {
      const trackSearch = `Night Drive ${discogsReleaseId}`;
      expect(await searchMusicTracks(trackSearch)).toEqual([]);
      const copies = await Promise.all(
        ["A", "B"].map((section) =>
          createInventoryItemInDatabase({
            format: "cd",
            music_release_id: release.id,
            zone: "S",
            section,
            upc_ean: null,
          }),
        ),
      );
      inventoryIds.push(...copies.map((copy) => copy.id));
      await pool.query("UPDATE inventory_items SET availability = FALSE WHERE id = $1", [
        copies[1]!.id,
      ]);

      const regularStock = await listStockDiscsFromDatabase({
        page: 1,
        pageSize: 1000,
      });
      expect(regularStock.items.some((item) => inventoryIds.includes(item.id))).toBe(false);
      const cdStock = await listStockDiscsFromDatabase({
        formats: ["cd"],
        page: 1,
        pageSize: 1000,
      });
      expect(inventoryIds.every((id) => cdStock.items.some((item) => item.id === id))).toBe(true);
      const artistAlbumSearch = await listStockDiscsFromDatabase({
        formats: ["cd"],
        q: "Test Artist",
        page: 1,
        pageSize: 100,
      });
      expect(
        inventoryIds.every((id) => artistAlbumSearch.items.some((item) => item.id === id)),
      ).toBe(true);

      const results = await searchMusicTracks(trackSearch);
      const artistTrackResults = await searchMusicTracks("Test Artist");
      const unrelatedArtistResults = await searchMusicTracks(
        `Unknown Performer ${discogsReleaseId}`,
      );
      const linkedCopies = await pool.query<{ count: number }>(
        `
          SELECT COUNT(*)::integer AS count
          FROM inventory_item_music_releases
          WHERE music_release_id = $1;
        `,
        [release.id],
      );
      const detail = await getMusicReleaseForStaff(release.id);
      const itemDetail = await getInventoryItemById(copies[0]!.id);
      const stockSections = await getAlphabeticalStockSectionsFromDatabase({
        zones: ["S"],
        formats: ["cd"],
      });
      const stockPage = await listStockDiscsFromDatabase({
        zones: ["S"],
        formats: ["cd"],
        q: `CD Test Release ${discogsReleaseId}`,
      });

      expect(linkedCopies.rows[0]!.count).toBe(2);
      expect(detail.inventoryCopies).toHaveLength(2);
      expect(results).toHaveLength(1);
      expect(results.map((result) => result.track.title)).toEqual([trackSearch]);
      expect(results[0]!.inventoryCopies).toHaveLength(2);
      expect(new Set(results[0]!.inventoryCopies.map((copy) => copy.id)).size).toBe(2);
      expect(results.every((result) => result.release.id === release.id)).toBe(true);
      expect(artistTrackResults.some((result) => result.release.id === release.id)).toBe(true);
      expect(
        artistTrackResults.some(
          (result) => result.release.id === release.id && result.track.title === trackSearch,
        ),
      ).toBe(true);
      expect(unrelatedArtistResults).toEqual([]);
      expect(
        results.every(
          (result) => result.release.sortTitle === `CD Test Release ${discogsReleaseId}`,
        ),
      ).toBe(true);
      expect(results[0]!.inventoryCopies.some((copy) => copy.availability === false)).toBe(true);
      expect(itemDetail.linkedMusicRelease).toMatchObject({
        id: release.id,
        title: releaseSnapshot(discogsReleaseId).title,
        sortTitle: `CD Test Release ${discogsReleaseId}`,
      });
      expect(
        stockSections
          .flatMap((section) => section.items)
          .some(
            (item) =>
              item.id === copies[0]!.id &&
              item.sortAnchor === `CD Test Release ${discogsReleaseId}`,
          ),
      ).toBe(true);
      expect(
        stockPage.items.some(
          (item) =>
            item.id === copies[0]!.id &&
            item.linkedMusicRelease?.id === release.id &&
            item.sortAnchor === `CD Test Release ${discogsReleaseId}`,
        ),
      ).toBe(true);
    } finally {
      if (inventoryIds.length > 0) {
        await pool.query("DELETE FROM inventory_items WHERE id = ANY($1::uuid[])", [inventoryIds]);
      }
      await pool.query("DELETE FROM music_releases WHERE id = $1", [release.id]);
    }
  });

  it("rejects video copies linked to music releases and prevents CD format changes while linked", async () => {
    const discogsReleaseId = uniqueDiscogsReleaseId();
    const release = await storeDiscogsMusicRelease(releaseSnapshot(discogsReleaseId));
    const title = `Music link guard ${randomUUID()}`;
    const titleResult = await pool.query<{ id: string }>(
      `
        INSERT INTO titles (tmdb_id, media_type, title, sort_title, release_year, metadata_source)
        VALUES (NULL, 'movie', $1, $1, 2005, 'manual')
        RETURNING id;
      `,
      [title],
    );
    let videoItemId: string | undefined;
    let cdItemId: string | undefined;

    try {
      const videoItem = await createInventoryItemInDatabase({
        title_ids: titleResult.rows[0]!.id,
        format: "dvd",
        zone: "S",
        section: "G",
      });
      videoItemId = videoItem.id;
      await expect(
        linkCdInventoryItemToMusicRelease(videoItem.id, release.id),
      ).rejects.toMatchObject({ statusCode: 409 });

      const cdItem = await createInventoryItemInDatabase({
        format: "cd",
        music_release_id: release.id,
        zone: "S",
        section: "H",
        reviewed: false,
      });
      cdItemId = cdItem.id;
      await updateInventoryItemInDatabase(cdItem.id, { reviewed: false });
      await expect(
        updateInventoryItemInDatabase(cdItem.id, { format: "dvd" }),
      ).rejects.toMatchObject({ statusCode: 409 });

      const stored = await pool.query<{ format: string; reviewed: boolean }>(
        "SELECT format, reviewed FROM inventory_items WHERE id = $1",
        [cdItem.id],
      );
      expect(stored.rows[0]!.format).toBe("cd");
      expect(stored.rows[0]!.reviewed).toBe(true);
    } finally {
      const itemIds = [videoItemId, cdItemId].filter((id): id is string => Boolean(id));
      if (itemIds.length > 0) {
        await pool.query("DELETE FROM inventory_items WHERE id = ANY($1::uuid[])", [itemIds]);
      }
      await pool.query("DELETE FROM titles WHERE id = $1", [titleResult.rows[0]!.id]);
      await pool.query("DELETE FROM music_releases WHERE id = $1", [release.id]);
    }
  });
});
