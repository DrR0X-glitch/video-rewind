import { describe, expect, it } from "vitest";

import { CustomTitleInputError, normalizeCustomTitleInput } from "@/lib/catalog/custom-title-input";

describe("custom title input", () => {
  it("normalizes manually entered required metadata", () => {
    expect(
      normalizeCustomTitleInput({
        title: "  The Shop Around the Corner  ",
        sortTitle: "Shop Around the Corner",
        mediaType: "movie",
        releaseYear: "1940",
        genres: "Comedy, Romance, comedy",
        director: "Ernst Lubitsch",
      }),
    ).toEqual({
      title: "The Shop Around the Corner",
      sortTitle: "Shop Around the Corner",
      mediaType: "movie",
      releaseYear: 1940,
      overview: "",
      genres: ["Comedy", "Romance"],
      director: "Ernst Lubitsch",
    });
  });

  it.each([
    [{ title: "", mediaType: "movie", sortTitle: "A", releaseYear: 2020 }, "title"],
    [
      { title: "Sample", mediaType: "documentary", sortTitle: "Sample", releaseYear: 2020 },
      "mediaType",
    ],
    [{ title: "Sample", mediaType: "movie", releaseYear: 2020 }, "sortTitle"],
    [{ title: "Sample", mediaType: "movie", sortTitle: "Sample" }, "releaseYear"],
    [
      { title: "Sample", mediaType: "movie", sortTitle: "Sample", releaseYear: "20" },
      "releaseYear",
    ],
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
