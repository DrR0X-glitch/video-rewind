import { describe, expect, it } from "vitest";
import {
  formatDiscFormat,
  formatLinkedTitleLabel,
  formatMovieTitleWithYear,
  formatReleaseYear,
  formatSeasonRange,
} from "../../lib/format";
import { formatZoneLabel } from "../../lib/constants";

describe("catalogue and inventory formatting", () => {
  it("formats a release year and handles an invalid date", () => {
    expect(formatReleaseYear("1999-03-31")).toBe("1999");
    expect(formatReleaseYear("0001-01-01")).toBe("0001");
    expect(formatReleaseYear(1)).toBe("0001");
    expect(formatReleaseYear("not-a-date")).toBe("Unknown");
    expect(formatMovieTitleWithYear("The Matrix", "1999-03-31")).toBe("The Matrix (1999)");
  });

  it("formats single and ranged seasons", () => {
    expect(formatSeasonRange(2, 2)).toBe("Season 2");
    expect(formatSeasonRange(1, 3)).toBe("Seasons 1-3");
    expect(formatSeasonRange()).toBe("");
  });

  it("includes season and episode spans in series labels", () => {
    expect(
      formatLinkedTitleLabel({
        title: "Example Series",
        releaseYear: 2020,
        mediaType: "series",
        seasonStart: 1,
        seasonEnd: 2,
        episodeStart: 3,
        episodeEnd: 4,
      }),
    ).toBe("Example Series (2020) Seasons 1-2 Episodes 3-4");
  });

  it("maps disc formats and storage zones to display labels", () => {
    expect(formatDiscFormat("4k-uhd")).toBe("4K UHD");
    expect(formatDiscFormat("vhs")).toBe("VHS");
    expect(formatZoneLabel("W")).toBe("Wall");
  });
});
