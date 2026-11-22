import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UpcEanInput } from "@/components/upc-ean-input";

describe("UpcEanInput", () => {
  afterEach(() => cleanup());

  it("provides a manual UPC/EAN field and camera scan control", () => {
    render(<UpcEanInput defaultValue="012345678905" />);

    const input = screen.getByRole("textbox", { name: "UPC/EAN barcode (optional)" });
    expect((input as HTMLInputElement).value).toBe("012345678905");
    expect(screen.getByRole("button", { name: "Scan with camera" })).toBeTruthy();

    fireEvent.change(input, { target: { value: "4006381333931" } });
    expect((input as HTMLInputElement).value).toBe("4006381333931");
  });
});
