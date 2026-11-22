import { describe, expect, it } from "vitest";

import { CustomTitleInputError, normalizeCustomTitleInput } from "@/lib/catalog/custom-title-input";

describe("custom title input", () => {
  it("normalizes manual title metadata and suggests a sort title", () => {
    expect(
      normalizeCustomTitleInput({
        title: "  The Shop Around the Corner  ",
        mediaType: "movie",
        releaseDate: "1940-01-12",
        genres: "Comedy, Romance, comedy",
        director: "Ernst Lubitsch",
      }),
    ).toEqual({
      title: "The Shop Around the Corner",
      sortTitle: "Shop Around the Corner",
      mediaType: "movie",
      releaseDate: "1940-01-12",
      overview: "",
      genres: ["Comedy", "Romance"],
      director: "Ernst Lubitsch",
    });
  });

  it("accepts manual TV series titles and a supplied sort title", () => {
    expect(
      normalizeCustomTitleInput({
        title: "Mini Series",
        sortTitle: "Series, Mini",
        mediaType: "series",
      }),
    ).toMatchObject({
      title: "Mini Series",
      sortTitle: "Series, Mini",
      mediaType: "series",
      releaseDate: null,
    });
  });

  it.each([
    [{ title: "", mediaType: "movie" }, "title"],
    [{ title: "Sample", mediaType: "documentary" }, "mediaType"],
    [{ title: "Sample", mediaType: "movie", releaseDate: "2026-02-30" }, "releaseDate"],
  ] as const)("rejects invalid input %j", (input, field) => {
    let error: unknown;
    try {
      normalizeCustomTitleInput(input);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CustomTitleInputError);
    expect(error).toMatchObject({ field });
  });
});
