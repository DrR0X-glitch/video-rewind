import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeFormat } from "@/lib/server/http";

describe("inventory format input", () => {
  it.each(["dvd", "blu-ray", "4k-uhd", "vhs"])("accepts %s", (format) => {
    expect(normalizeFormat(format)).toBe(format);
  });
});
