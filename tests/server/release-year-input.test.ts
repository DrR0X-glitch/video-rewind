import { describe, expect, it } from "vitest";

import { normalizeReleaseYearInput, ReleaseYearInputError } from "@/lib/catalog/release-year-input";

describe("release year input", () => {
  it.each([
    [1900, 1900],
    ["2024", 2024],
    [" 1987 ", 1987],
  ])("normalizes %s", (value, expected) => {
    expect(normalizeReleaseYearInput(value)).toBe(expected);
  });

  it("rejects a missing year", () => {
    expect(normalizeReleaseYearInput("")).toBeNull();
  });

  it.each(["20", "10000", "abcd", 1999.5])("rejects invalid year %s", (value) => {
    expect(() => normalizeReleaseYearInput(value)).toThrow(ReleaseYearInputError);
  });
});
