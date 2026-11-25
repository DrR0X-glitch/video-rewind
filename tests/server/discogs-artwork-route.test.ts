import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/discogs/artwork/route";

describe("Discogs artwork route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("only serves the configured Discogs image hosts", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        `http://localhost/api/discogs/artwork?src=${encodeURIComponent("https://example.com/pixel.jpg")}`,
      ),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches without upstream caching and allows only six hours in the browser cache", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const source = "https://i.discogs.com/releases/cover.jpg";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(`http://localhost/api/discogs/artwork?src=${encodeURIComponent(source)}`),
    );

    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(source);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", redirect: "error" });
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=21600, must-revalidate");
    expect(response.headers.get("CDN-Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("is disabled outside local development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/discogs/artwork?src=https%3A%2F%2Fi.discogs.com%2Fa.jpg"),
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
