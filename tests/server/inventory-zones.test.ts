import { describe, expect, it } from "vitest";

import {
  parseInventoryZoneCode,
  parseInventoryZoneIdentifier,
  parseInventoryZoneLabel,
} from "@/lib/inventory-zones";

describe("inventory zone input", () => {
  it("normalizes short codes while preserving the existing code format", () => {
    expect(parseInventoryZoneCode(" s ")).toBe("S");
    expect(parseInventoryZoneCode("A2")).toBe("A2");
    expect(parseInventoryZoneCode("ABCD")).toBe("ABCD");
  });

  it("rejects codes outside the supported 1 to 4 character range", () => {
    expect(parseInventoryZoneCode(7)).toBeNull();
    expect(parseInventoryZoneCode("")).toBeNull();
    expect(parseInventoryZoneCode("A B")).toBeNull();
    expect(parseInventoryZoneCode("ABCDE")).toBeNull();
    expect(parseInventoryZoneCode("A-")).toBeNull();
  });

  it("trims and bounds zone names", () => {
    expect(parseInventoryZoneLabel("  Archive  ")).toBe("Archive");
    expect(parseInventoryZoneLabel("")).toBeNull();
    expect(parseInventoryZoneLabel("x".repeat(41))).toBeNull();
  });

  it("continues to recognize previously assigned legacy identifiers", () => {
    expect(parseInventoryZoneIdentifier("legacy shelf")).toBe("LEGACY SHELF");
    expect(parseInventoryZoneIdentifier("legacy-shelf-1")).toBe("LEGACY-SHELF-1");
  });
});
