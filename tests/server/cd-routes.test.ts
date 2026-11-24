import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/catalog/discogs", () => ({
  DiscogsApiError: class DiscogsApiError extends Error {
    code: string;
    rateLimit: null = null;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  fetchDiscogsReleaseDraft: vi.fn(),
  searchDiscogsReleaseCandidates: vi.fn(),
}));
vi.mock("@/lib/server/catalog/music-releases", () => ({
  createManualMusicRelease: vi.fn(),
  getMusicReleaseForStaff: vi.fn(),
  getStoredMusicReleaseByDiscogsId: vi.fn(),
  linkCdInventoryItemToMusicRelease: vi.fn(),
  searchMusicTracks: vi.fn(),
  storeDiscogsMusicRelease: vi.fn(),
  updateMusicReleaseSortTitle: vi.fn(),
}));

import { NextRequest } from "next/server";

import { GET as getDiscogsSearch } from "@/app/api/discogs/search/route";
import { GET as getDiscogsRelease } from "@/app/api/discogs/releases/[discogsReleaseId]/route";
import { POST as postMusicRelease } from "@/app/api/music/releases/route";
import {
  GET as getMusicRelease,
  PATCH as patchMusicRelease,
} from "@/app/api/music/releases/[id]/route";
import { GET as getStoredDiscogsRelease } from "@/app/api/music/releases/by-discogs/[discogsReleaseId]/route";
import { GET as getMusicTracks } from "@/app/api/music/tracks/route";
import {
  DiscogsApiError,
  fetchDiscogsReleaseDraft,
  searchDiscogsReleaseCandidates,
} from "@/lib/server/catalog/discogs";
import {
  createManualMusicRelease,
  getMusicReleaseForStaff,
  getStoredMusicReleaseByDiscogsId,
  linkCdInventoryItemToMusicRelease,
  searchMusicTracks,
  storeDiscogsMusicRelease,
  updateMusicReleaseSortTitle,
} from "@/lib/server/catalog/music-releases";

const releaseDraft = {
  discogsReleaseId: 123,
  title: "Example Album",
  artists: ["Example Artist"],
  releaseYear: 2001,
  country: "AU",
  label: "Example Records",
  catalogNumber: "EX-1",
  barcode: null,
  artworkUrl: "https://i.discogs.com/cover.jpg",
  discogsUrl: "https://www.discogs.com/release/123",
  tracks: [],
};

const storedRelease = {
  id: "11111111-1111-4111-8111-111111111111",
  source: "discogs" as const,
  discogsReleaseId: 123,
  title: "Example Album",
  sortTitle: "Example Album Sort",
  artistCredit: "Example Artist",
  releaseYear: 2001,
  country: "AU",
  label: "Example Records",
  catalogNumber: "EX-1",
  discogsUrl: "https://www.discogs.com/release/123",
  sourceFetchedAt: new Date("2026-11-24T00:00:00Z"),
  tracks: [],
  inventoryCopies: [],
};

describe("CD catalog API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
  });

  it("returns 404 outside development before touching Discogs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await getDiscogsSearch(
      new NextRequest("http://localhost/api/discogs/search?q=example"),
    );

    expect(response.status).toBe(404);
    expect(searchDiscogsReleaseCandidates).not.toHaveBeenCalled();
  });

  it("exposes text search results and rejects an empty query", async () => {
    vi.mocked(searchDiscogsReleaseCandidates).mockResolvedValue({
      results: [],
      page: 1,
      perPage: 20,
      totalResults: 0,
      rateLimit: { limit: 25, used: 1, remaining: 24, retryAfterMs: null },
    });
    const response = await getDiscogsSearch(
      new NextRequest("http://localhost/api/discogs/search?q=Example%20Artist"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(searchDiscogsReleaseCandidates).toHaveBeenCalledWith({
      query: "Example Artist",
      page: 1,
      perPage: 20,
    });
    expect(body.totalResults).toBe(0);

    const emptyResponse = await getDiscogsSearch(
      new NextRequest("http://localhost/api/discogs/search?q="),
    );
    expect(emptyResponse.status).toBe(400);
  });

  it("previews the exact selected Discogs release", async () => {
    vi.mocked(fetchDiscogsReleaseDraft).mockResolvedValue(releaseDraft);
    const response = await getDiscogsRelease(new Request("http://localhost"), {
      params: Promise.resolve({ discogsReleaseId: "123" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      discogsReleaseId: releaseDraft.discogsReleaseId,
      title: releaseDraft.title,
      artists: releaseDraft.artists,
      releaseYear: releaseDraft.releaseYear,
      country: releaseDraft.country,
      label: releaseDraft.label,
      catalogNumber: releaseDraft.catalogNumber,
      artworkUrl: releaseDraft.artworkUrl,
      discogsUrl: releaseDraft.discogsUrl,
      tracks: releaseDraft.tracks,
    });
    expect(fetchDiscogsReleaseDraft).toHaveBeenCalledWith("123");
  });

  it("fetches, stores, and returns a selected release, with optional copy linking", async () => {
    vi.mocked(fetchDiscogsReleaseDraft).mockResolvedValue(releaseDraft);
    vi.mocked(storeDiscogsMusicRelease).mockResolvedValue({
      id: storedRelease.id,
      discogsReleaseId: 123,
      title: storedRelease.title,
      sortTitle: storedRelease.sortTitle,
      artistCredit: storedRelease.artistCredit,
      releaseYear: storedRelease.releaseYear,
      trackCount: 0,
      replacedTrackCount: 0,
    });
    vi.mocked(getMusicReleaseForStaff).mockResolvedValue(storedRelease);

    const response = await postMusicRelease(
      new Request("http://localhost/api/music/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discogsReleaseId: 123,
          sortTitle: "Example Album Sort",
          inventoryItemId: "22222222-2222-4222-8222-222222222222",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: storedRelease.id,
      title: storedRelease.title,
      sortTitle: storedRelease.sortTitle,
      artistCredit: storedRelease.artistCredit,
      releaseYear: storedRelease.releaseYear,
    });
    expect(storeDiscogsMusicRelease).toHaveBeenCalledWith(releaseDraft, "Example Album Sort");
    expect(linkCdInventoryItemToMusicRelease).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      storedRelease.id,
    );
    expect(getMusicReleaseForStaff).toHaveBeenCalledWith(storedRelease.id);
  });

  it("returns an existing release from POST without refreshing its metadata", async () => {
    vi.mocked(getStoredMusicReleaseByDiscogsId).mockResolvedValue(storedRelease);

    const response = await postMusicRelease(
      new Request("http://localhost/api/music/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discogsReleaseId: 123, sortTitle: "Changed sort title" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: storedRelease.id,
      sortTitle: storedRelease.sortTitle,
      tracks: storedRelease.tracks,
    });
    expect(fetchDiscogsReleaseDraft).not.toHaveBeenCalled();
    expect(storeDiscogsMusicRelease).not.toHaveBeenCalled();
  });

  it("updates only an existing release sort title", async () => {
    vi.mocked(updateMusicReleaseSortTitle).mockResolvedValue({
      ...storedRelease,
      sortTitle: "Edited Album Sort",
    });
    const response = await patchMusicRelease(
      new Request("http://localhost/api/music/releases/id", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortTitle: "Edited Album Sort" }),
      }),
      { params: Promise.resolve({ id: storedRelease.id }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ sortTitle: "Edited Album Sort" });
    expect(updateMusicReleaseSortTitle).toHaveBeenCalledWith(storedRelease.id, "Edited Album Sort");
    expect(storeDiscogsMusicRelease).not.toHaveBeenCalled();
  });

  it("creates manual releases without Discogs identifiers or attribution", async () => {
    vi.mocked(createManualMusicRelease).mockResolvedValue({
      id: storedRelease.id,
      source: "manual",
      discogsReleaseId: null,
      discogsUrl: null,
      title: "Local Album",
      sortTitle: "Local Album Sort",
      artistCredit: "Local Artist",
      releaseYear: 1998,
      trackCount: 1,
      replacedTrackCount: 0,
    });
    const manualDetail = {
      ...storedRelease,
      source: "manual" as const,
      discogsReleaseId: null,
      discogsUrl: null,
      title: "Local Album",
      sortTitle: "Local Album Sort",
      artistCredit: "Local Artist",
      releaseYear: 1998,
      tracks: [
        {
          id: "track-1",
          sequenceNo: 1,
          position: "1",
          title: "First Song",
          entryType: "track" as const,
          durationSeconds: null,
          parentTrackId: null,
        },
      ],
    };
    vi.mocked(getMusicReleaseForStaff).mockResolvedValue(manualDetail);
    const response = await postMusicRelease(
      new Request("http://localhost/api/music/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          title: "Local Album",
          sortTitle: "Local Album Sort",
          artistCredit: "Local Artist",
          releaseYear: "1998",
          tracks: ["First Song"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createManualMusicRelease).toHaveBeenCalledWith({
      title: "Local Album",
      sortTitle: "Local Album Sort",
      artistCredit: "Local Artist",
      releaseYear: "1998",
      tracks: ["First Song"],
    });
    expect(fetchDiscogsReleaseDraft).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      source: "manual",
      discogsReleaseId: null,
      discogsUrl: null,
    });
  });

  it("reuses a locally stored Discogs release without fetching or replacing it", async () => {
    vi.mocked(getStoredMusicReleaseByDiscogsId).mockResolvedValue(storedRelease);

    const response = await getStoredDiscogsRelease(new Request("http://localhost"), {
      params: Promise.resolve({ discogsReleaseId: "123" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      id: storedRelease.id,
      sortTitle: storedRelease.sortTitle,
      tracks: [],
    });
    expect(getStoredMusicReleaseByDiscogsId).toHaveBeenCalledWith("123");
    expect(fetchDiscogsReleaseDraft).not.toHaveBeenCalled();
    expect(storeDiscogsMusicRelease).not.toHaveBeenCalled();
  });

  it("maps Discogs throttling and serves stored release and local track reads", async () => {
    vi.mocked(searchDiscogsReleaseCandidates).mockRejectedValue(
      new DiscogsApiError("rate_limited", "Discogs rate limit reached"),
    );
    const throttled = await getDiscogsSearch(
      new NextRequest("http://localhost/api/discogs/search?q=example"),
    );
    expect(throttled.status).toBe(429);

    vi.mocked(getMusicReleaseForStaff).mockResolvedValue(storedRelease);
    const releaseResponse = await getMusicRelease(
      new Request("http://localhost/api/music/releases/11111111-1111-4111-8111-111111111111"),
      { params: Promise.resolve({ id: storedRelease.id }) },
    );
    expect(releaseResponse.status).toBe(200);

    vi.mocked(searchMusicTracks).mockResolvedValue([]);
    const trackResponse = await getMusicTracks(
      new Request("http://localhost/api/music/tracks?q=example&limit=12"),
    );
    expect(trackResponse.status).toBe(200);
    expect(searchMusicTracks).toHaveBeenCalledWith("example", 12);
  });
});
