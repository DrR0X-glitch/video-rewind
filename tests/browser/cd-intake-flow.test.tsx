import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CdIntakeFlow } from "@/app/inventory/new/cd/cd-intake-flow";

const zones = [
  { code: "W", label: "Wall", isActive: true },
  { code: "S", label: "Shelf", isActive: true },
];

const candidate = {
  discogsReleaseId: 12345,
  title: "Blue Train",
  releaseYear: 1957,
  country: "US",
  formats: ["CD"],
  labels: ["Blue Note"],
  catalogNumber: "CDP 7 46095 2",
  discogsUrl: "https://www.discogs.com/release/12345",
};

const release = {
  ...candidate,
  artworkUrl: "https://i.discogs.com/cover.jpg",
  artists: ["John Coltrane"],
  label: "Blue Note",
  tracks: [
    {
      sequenceNo: 1,
      position: "CD 1",
      title: "Disc One",
      entryType: "heading" as const,
      durationSeconds: null,
      parentSequenceNo: null,
    },
    {
      sequenceNo: 2,
      position: "1-1",
      title: "Blue Train",
      entryType: "track" as const,
      durationSeconds: 642,
      parentSequenceNo: null,
    },
  ],
};

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
const scrollIntoViewMock = vi.fn();

describe("CdIntakeFlow", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    scrollIntoViewMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("searches by text, confirms an exact release, then adds a copy with UPC/EAN", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/discogs/search")) {
        return Response.json({ results: [candidate], totalResults: 1 });
      }
      if (url === "/api/music/releases/by-discogs/12345") {
        return Response.json({ error: "Stored Discogs release not found" }, { status: 404 });
      }
      if (url === "/api/discogs/releases/12345") return Response.json(release);
      if (url === "/api/music/releases") {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          discogsReleaseId: 12345,
          sortTitle: "Blue Train",
        });
        return Response.json({ id: "release-id", title: "Blue Train" });
      }
      if (url === "/api/inventory") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          format: "cd",
          music_release_id: "release-id",
          zone: "W",
          section: "A",
          upc_ean: "012345678905",
          availability: true,
          sealed: true,
        });
        return Response.json({ id: "copy-id", inventoryCode: "24" }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CdIntakeFlow zones={zones} defaultZone="W" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Artist or release title" }), {
      target: { value: "John Coltrane" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByRole("button", { name: "Check edition" });
    expect(screen.getByText("1957")).toBeTruthy();
    expect(screen.getByText("US")).toBeTruthy();
    expect(screen.getByText("CD")).toBeTruthy();
    expect(screen.getByText("Blue Note").getAttribute("title")).toBe("Blue Note");
    expect(screen.getByText("CDP 7 46095 2")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Check edition" }));
    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalled());
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(await screen.findByText("Blue Train", { selector: "li span" })).toBeTruthy();
    const cover = await screen.findByRole("img", { name: "Blue Train album cover" });
    expect(cover.getAttribute("src")).toContain("/api/discogs/artwork?src=");
    expect(screen.getByText("Disc One", { selector: "li" }).className).toContain(
      "cd-track-heading",
    );
    expect(screen.getByText("1-1").className).toContain("cd-track-position");
    expect(screen.getByText("10:42").className).toContain("cd-track-duration");
    expect((screen.getByRole("textbox", { name: "Sort title" }) as HTMLInputElement).value).toBe(
      "Blue Train",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save release and continue" }));

    const section = await screen.findByRole("textbox", { name: "Section" });
    fireEvent.change(section, { target: { value: "A" } });
    fireEvent.change(screen.getByRole("textbox", { name: "UPC/EAN barcode (optional)" }), {
      target: { value: "012345678905" },
    });
    const barcodeInput = screen.getByRole("textbox", { name: "UPC/EAN barcode (optional)" });
    const cameraButton = screen.getByRole("button", { name: "Scan with camera" });
    expect(barcodeInput.closest(".upc-ean-entry")?.contains(cameraButton)).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Sealed?" }));
    fireEvent.click(screen.getByRole("button", { name: "Add CD to stock" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Added Blue Train"),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/discogs/search?q=John%20Coltrane");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("barcode="))).toBe(false);
  });

  it("shows a clear message when the text search has no candidate releases", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ results: [], totalResults: 0 })),
    );
    render(<CdIntakeFlow zones={zones} defaultZone="W" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Artist or release title" }), {
      target: { value: "No Such Artist" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "No matching CD releases found",
    );
  });

  it("shares remembered physical-copy defaults with movie intake", async () => {
    window.localStorage.setItem(
      "inventory-new-disc-defaults",
      JSON.stringify({
        format: "dvd",
        sealed: true,
        zone: "S",
        row: "B",
        sectionOverride: "Q",
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/discogs/search")) {
          return Response.json({ results: [candidate], totalResults: 1 });
        }
        if (url === "/api/music/releases/by-discogs/12345") {
          return Response.json({ error: "Stored Discogs release not found" }, { status: 404 });
        }
        if (url === "/api/discogs/releases/12345") return Response.json(release);
        if (url === "/api/music/releases") {
          return Response.json({ id: "release-id", title: "Blue Train", sortTitle: "Blue Train" });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<CdIntakeFlow zones={zones} defaultZone="W" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Artist or release title" }), {
      target: { value: "Blue Train" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Check edition" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save release and continue" }));

    const addCopyButton = await screen.findByRole("button", { name: "Add CD to stock" });
    expect((screen.getByRole("radio", { name: "Shelf" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("textbox", { name: /Section/ }) as HTMLInputElement).value).toBe("Q");
    expect(
      (screen.getByRole("textbox", { name: "Row (optional)" }) as HTMLInputElement).value,
    ).toBe("B");
    expect((screen.getByRole("checkbox", { name: "Sealed?" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("checkbox", { name: "Available?" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByLabelText("Day price") as HTMLInputElement).value).toBe("0");
    fireEvent.change(screen.getByRole("textbox", { name: "Row (optional)" }), {
      target: { value: "C" },
    });
    await waitFor(() => {
      const persisted = JSON.parse(
        window.localStorage.getItem("inventory-new-disc-defaults") ?? "{}",
      );
      expect(persisted).toMatchObject({ format: "dvd", zone: "S", sealed: true, row: "C" });
    });
    expect(addCopyButton).toBeTruthy();
  });

  it("lets staff edit a reused release sort title without replacing its tracks", async () => {
    const storedRelease = {
      id: "saved-release-id",
      discogsReleaseId: 12345,
      title: "Blue Train",
      sortTitle: "Stored sort title",
      artistCredit: "John Coltrane",
      releaseYear: 1957,
      country: "US",
      label: "Blue Note",
      catalogNumber: "CDP 7 46095 2",
      discogsUrl: "https://www.discogs.com/release/12345",
      tracks: [
        {
          id: "stored-track-id",
          sequenceNo: 1,
          position: "1-1",
          title: "Stored Track Listing",
          entryType: "track" as const,
          durationSeconds: 642,
          parentTrackId: null,
        },
      ],
      inventoryCopies: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/discogs/search")) {
        return Response.json({ results: [candidate], totalResults: 1 });
      }
      if (url === "/api/music/releases/by-discogs/12345") {
        return Response.json(storedRelease);
      }
      if (url === "/api/discogs/releases/12345") return Response.json(release);
      if (url === "/api/music/releases/saved-release-id" && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({ sortTitle: "Edited sort title" });
        return Response.json({ ...storedRelease, sortTitle: "Edited sort title" });
      }
      if (url === "/api/music/releases")
        throw new Error("Existing releases should not be replaced");
      if (url === "/api/inventory") {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          format: "cd",
          music_release_id: "saved-release-id",
          zone: "W",
          section: "C",
        });
        return Response.json({ id: "copy-id", inventoryCode: "26" }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CdIntakeFlow zones={zones} defaultZone="W" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Artist or release title" }), {
      target: { value: "John Coltrane" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Check edition" }));

    expect(await screen.findByText(/already in your catalogue/i)).toBeTruthy();
    const sortTitle = screen.getByRole("textbox", { name: "Sort title" }) as HTMLInputElement;
    expect(sortTitle.disabled).toBe(false);
    fireEvent.change(sortTitle, { target: { value: "Edited sort title" } });
    expect(screen.getByText("Stored Track Listing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save sort title and continue" }));
    await screen.findByRole("button", { name: "Add CD to stock" });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === "/api/music/releases/saved-release-id"),
    ).toBe(true);

    fireEvent.change(screen.getByRole("textbox", { name: "Section" }), {
      target: { value: "C" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add CD to stock" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Added Blue Train"),
    );
  });

  it("truncates long label and release-type metadata by text length", async () => {
    const longCandidate = {
      ...candidate,
      formats: ["CD", "Album", "Reissue", "Remastered", "Limited Edition", "Import"],
      labels: ["Warner Bros Records", "Long imprint name with additional words"],
    };
    const fullFormat = longCandidate.formats.join(", ");
    const fullLabel = longCandidate.labels.join(", ");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ results: [longCandidate], totalResults: 1 })),
    );

    render(<CdIntakeFlow zones={zones} defaultZone="W" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Artist or release title" }), {
      target: { value: "Blue Train" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const format = await screen.findByTitle(fullFormat);
    const label = screen.getByTitle(fullLabel);
    expect(format.textContent).toHaveLength(32);
    expect(label.textContent.length).toBeLessThanOrEqual(40);
    expect(label.textContent.length).toBeGreaterThan(32);
    expect(format.textContent).toMatch(/…$/);
    expect(label.textContent).toMatch(/…$/);
  });

  it("creates a manual release with optional track titles and then adds its copy", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/discogs/search")) {
        return Response.json({ results: [], totalResults: 0 });
      }
      if (url === "/api/music/releases") {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          source: "manual",
          title: "Local Album",
          sortTitle: "Local Album",
          artistCredit: "Local Artist",
          releaseYear: 1998,
          tracks: ["First Song", "Second Song"],
        });
        return Response.json({ id: "manual-release-id", title: "Local Album" }, { status: 201 });
      }
      if (url === "/api/inventory") {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          format: "cd",
          music_release_id: "manual-release-id",
          zone: "W",
          section: "B",
        });
        return Response.json({ id: "copy-id", inventoryCode: "25" }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CdIntakeFlow zones={zones} defaultZone="W" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Artist or release title" }), {
      target: { value: "Local Album" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "No match? Create manually" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Release title" }), {
      target: { value: "Local Album" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Artist / performer" }), {
      target: { value: "Local Artist" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Release year (optional)" }), {
      target: { value: "1998" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Track titles (optional, one per line)" }),
      {
        target: { value: "First Song\nSecond Song" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save manual release" }));

    const section = await screen.findByRole("textbox", { name: "Section" });
    fireEvent.change(section, { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Add CD to stock" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Added Local Album"),
    );
  });
});
