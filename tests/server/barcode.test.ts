import { describe, expect, it } from "vitest";
import { getCode128Metrics, getCode128Modules, validateInventoryCode } from "../../lib/barcode";

describe("inventory barcode helpers", () => {
  it("accepts inventory codes with a D prefix and digits", () => {
    expect(validateInventoryCode("D123456")).toBe(true);
  });

  it.each(["123456", "D", "D12A", " D123"])("rejects invalid inventory code %s", (value) => {
    expect(validateInventoryCode(value)).toBe(false);
  });

  it("creates Code 128-B modules for printable ASCII", () => {
    const modules = getCode128Modules("D123");

    expect(modules).toHaveLength(6 * "D123".length + 19);
    expect(modules.every(Number.isInteger)).toBe(true);
  });

  it("returns dimensions based on module width and bar height", () => {
    expect(getCode128Metrics("D1", 3, 48)).toMatchObject({
      width: (11 * 2 + 35) * 3,
      height: 48,
    });
  });

  it("rejects characters outside Code 128-B printable ASCII", () => {
    expect(() => getCode128Modules("D\n1")).toThrow("Code 128-B only supports ASCII 32-126");
  });
});
