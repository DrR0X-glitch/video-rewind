import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DiscogsApiError,
  fetchDiscogsReleaseDraft,
  searchDiscogsReleaseCandidates,
} from "@/lib/server/catalog/discogs";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function configureDiscogs() {
  vi.stubEnv("DISCOGS_USER_AGENT", "VideoRewind/0.1.0");
  vi.stubEnv("DISCOGS_CONSUMER_KEY", "test-consumer-key");
  vi.stubEnv("DISCOGS_CONSUMER_SECRET", "test-consumer-secret");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Discogs provider", () => {
  it("searches CD releases with the configured server-side identity and returns rate-limit headers", async () => {
    configureDiscogs();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          pagination: { page: 1, per_page: 20, items: 1 },
          results: [
            {
              id: 123,
              title: "Artist - Album",
              year: 1999,
              country: "Australia",
              format: ["CD", "Album"],
              label: ["Example Records"],
              catno: "EX-01",
              uri: "https://www.discogs.com/release/123-Artist-Album",
            },
          ],
        },
        {
          headers: {
            "x-discogs-ratelimit": "60",
            "x-discogs-ratelimit-used": "3",
            "x-discogs-ratelimit-remaining": "57",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchDiscogsReleaseCandidates({ barcode: "012345678905" });

    expect(result.results).toEqual([
      {
        discogsReleaseId: 123,
        title: "Artist - Album",
        releaseYear: 1999,
        country: "Australia",
        formats: ["CD", "Album"],
        labels: ["Example Records"],
        catalogNumber: "EX-01",
        discogsUrl: "https://www.discogs.com/release/123-Artist-Album",
      },
    ]);
    expect(result.rateLimit).toEqual({ limit: 60, used: 3, remaining: 57, retryAfterMs: null });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(requestUrl.pathname).toBe("/database/search");
    expect(requestUrl.searchParams.get("barcode")).toBe("012345678905");
    expect(requestUrl.searchParams.get("format")).toBe("CD");
    expect(requestUrl.searchParams.get("type")).toBe("release");
    expect(new Headers(requestInit.headers).get("user-agent")).toBe("VideoRewind/0.1.0");
    expect(new Headers(requestInit.headers).get("authorization")).toBe(
      "Discogs key=test-consumer-key, secret=test-consumer-secret",
    );
    expect(requestInit.cache).toBe("no-store");
  });

  it("maps compact release metadata and flattens nested tracks in display order", async () => {
    configureDiscogs();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: 456,
          title: "A Record",
          formats: [{ name: "CD", qty: "1" }],
          year: "2004",
          country: "US",
          uri: "https://www.discogs.com/release/456-A-Record",
          artists: [{ name: "The Example" }, { name: "Guest Artist" }],
          labels: [{ name: "Small Label", catno: "SL-5" }],
          identifiers: [
            { type: "Matrix / Runout", value: "ABC123" },
            { type: "Barcode", value: "012345678905" },
          ],
          images: [{ uri: "https://img.discogs.com/private-image.jpg" }],
          tracklist: [
            { type_: "heading", position: "CD 1", title: "Disc One" },
            {
              type_: "index",
              position: "1",
              title: "Suite",
              sub_tracks: [
                { type_: "track", position: "1-1", title: "First Song", duration: "3:05" },
                { type_: "track", position: "1-2", title: "Second Song", duration: "1:02:03" },
              ],
            },
            { type_: "track", position: "2", title: "Final Song", duration: "bad" },
          ],
        }),
      ),
    );

    const release = await fetchDiscogsReleaseDraft(456);

    expect(release).toEqual({
      discogsReleaseId: 456,
      title: "A Record",
      artists: ["The Example", "Guest Artist"],
      releaseYear: 2004,
      country: "US",
      label: "Small Label",
      catalogNumber: "SL-5",
      barcode: "012345678905",
      artworkUrl: "https://img.discogs.com/private-image.jpg",
      discogsUrl: "https://www.discogs.com/release/456-A-Record",
      tracks: [
        {
          sequenceNo: 1,
          position: "CD 1",
          title: "Disc One",
          entryType: "heading",
          durationSeconds: null,
          parentSequenceNo: null,
        },
        {
          sequenceNo: 2,
          position: "1",
          title: "Suite",
          entryType: "heading",
          durationSeconds: null,
          parentSequenceNo: null,
        },
        {
          sequenceNo: 3,
          position: "1-1",
          title: "First Song",
          entryType: "track",
          durationSeconds: 185,
          parentSequenceNo: 2,
        },
        {
          sequenceNo: 4,
          position: "1-2",
          title: "Second Song",
          entryType: "track",
          durationSeconds: 3723,
          parentSequenceNo: 2,
        },
        {
          sequenceNo: 5,
          position: "2",
          title: "Final Song",
          entryType: "track",
          durationSeconds: null,
          parentSequenceNo: null,
        },
      ],
    });
    expect(release.artworkUrl).toBe("https://img.discogs.com/private-image.jpg");
  });

  it("uses the package version for the default User-Agent and requires both credentials", async () => {
    vi.stubEnv("DISCOGS_USER_AGENT", "");
    vi.stubEnv("DISCOGS_CONSUMER_KEY", "key");
    vi.stubEnv("DISCOGS_CONSUMER_SECRET", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDiscogsReleaseDraft(1)).rejects.toMatchObject({
      name: "DiscogsApiError",
      code: "configuration",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("DISCOGS_CONSUMER_SECRET", "secret");
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 1, title: "Album", formats: [{ name: "CD" }], tracklist: [] }),
    );
    await fetchDiscogsReleaseDraft(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(new Headers(requestInit.headers).get("user-agent")).toBe("VideoRewind/0.1.0");
  });

  it("surfaces Discogs rate-limit headers and Retry-After without retrying", async () => {
    configureDiscogs();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { message: "Too many requests" },
        {
          status: 429,
          headers: {
            "x-discogs-ratelimit": "60",
            "x-discogs-ratelimit-used": "60",
            "x-discogs-ratelimit-remaining": "0",
            "retry-after": "7",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchDiscogsReleaseCandidates({ query: "artist album" })).rejects.toMatchObject({
      name: "DiscogsApiError",
      code: "rate_limited",
      status: 429,
      rateLimit: { limit: 60, used: 60, remaining: 0, retryAfterMs: 7000 },
    } satisfies Partial<DiscogsApiError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts requests that exceed the provider timeout", async () => {
    configureDiscogs();
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: URL, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchDiscogsReleaseDraft(456);
    const rejected = expect(result).rejects.toMatchObject({
      name: "DiscogsApiError",
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses a typed not-found error and validates release ids", async () => {
    configureDiscogs();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { status: 404 })));

    await expect(fetchDiscogsReleaseDraft(99)).rejects.toMatchObject({
      name: "DiscogsApiError",
      code: "not_found",
      status: 404,
    });
    await expect(fetchDiscogsReleaseDraft("abc")).rejects.toMatchObject({
      name: "DiscogsApiError",
      code: "invalid_request",
    });
  });

  it("rejects a release detail response that is not a CD", async () => {
    configureDiscogs();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: 789,
          title: "Vinyl Only Album",
          formats: [{ name: "Vinyl", qty: "1" }],
          tracklist: [{ type_: "track", position: "A1", title: "Opening Track" }],
        }),
      ),
    );

    await expect(fetchDiscogsReleaseDraft(789)).rejects.toMatchObject({
      name: "DiscogsApiError",
      code: "unsupported_format",
    });
  });
});
