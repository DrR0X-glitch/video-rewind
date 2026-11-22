import { describe, expect, it } from "vitest";

import { normalizeUpcEanInput, UpcEanInputError } from "@/lib/inventory/upc-ean";

describe("UPC/EAN input", () => {
  it.each(["012345678905", "4006381333931", "96385074", "12345678901231"])(
    "accepts %s while preserving leading zeroes",
    (value) => {
      expect(normalizeUpcEanInput(value)).toBe(value);
    },
  );

  it("removes spaces and hyphens from manually entered values", () => {
    expect(normalizeUpcEanInput("  0123-4567 8905 ")).toBe("012345678905");
  });

  it("treats an empty value as no barcode", () => {
    expect(normalizeUpcEanInput("  ")).toBeNull();
    expect(normalizeUpcEanInput(undefined)).toBeNull();
  });

  it.each(["1234567", "123456789012345", "12AB56789012", 1234567])(
    "rejects invalid UPC/EAN value %s",
    (value) => {
      expect(() => normalizeUpcEanInput(value)).toThrow(UpcEanInputError);
    },
  );
});
