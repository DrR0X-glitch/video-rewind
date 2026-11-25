import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scannerMocks = vi.hoisted(() => ({
  decode: vi.fn(),
  setFormats: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@zxing/browser", () => ({
  BarcodeFormat: { EAN_13: 1, EAN_8: 2, UPC_A: 3, UPC_E: 4 },
  BrowserMultiFormatOneDReader: class {
    set possibleFormats(formats: number[]) {
      scannerMocks.setFormats(formats);
    }

    decodeFromConstraints(...args: unknown[]) {
      return scannerMocks.decode(...args);
    }
  },
}));

import { UpcEanScanner } from "@/components/upc-ean-scanner";

describe("UpcEanScanner", () => {
  beforeEach(() => {
    scannerMocks.decode.mockImplementation(async (_constraints, _video, onResult) => {
      (onResult as (result: { getText: () => string }) => void)({
        getText: () => "012345678905",
      });
      return { stop: scannerMocks.stop };
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("starts ZXing with UPC/EAN formats and returns a detected value", async () => {
    const onDetected = vi.fn();
    render(<UpcEanScanner onDetected={onDetected} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan with camera" }));

    await waitFor(() => expect(onDetected).toHaveBeenCalledWith("012345678905"));
    expect(scannerMocks.setFormats).toHaveBeenCalledWith([1, 2, 3, 4]);
    expect(screen.getByRole("status").textContent).toContain("Scanned 012345678905");
  });
});
