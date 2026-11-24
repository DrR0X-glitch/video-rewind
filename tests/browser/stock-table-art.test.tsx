import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StockTableBody } from "@/components/stock-table-body";
import type { StockViewDisc } from "@/lib/types";

const item: StockViewDisc = {
  id: "disc-1",
  inventoryCode: "D-1",
  upcEan: null,
  format: "dvd",
  availability: true,
  reviewed: true,
  sealed: false,
  zone: "W",
  zoneLabel: "Wall",
  section: "A",
  row: "1",
  locationCode: "W/A1",
  linkedTitles: [
    {
      id: "title-1",
      title: "The Matrix",
      sortTitle: "Matrix, The",
      mediaType: "movie",
      releaseDate: "1999-03-31",
      releaseYear: 1999,
      posterUrl: "https://image.tmdb.org/t/p/w200/matrix.jpg",
    },
    {
      id: "title-2",
      title: "Custom Feature",
      sortTitle: "Custom Feature",
      mediaType: "movie",
      releaseDate: "",
      releaseYear: 2024,
      posterUrl: null,
    },
  ],
  notes: "",
  lastRentedAt: undefined,
  dayPrice: 0,
  weekendPrice: 0,
  lateClass: 0,
  updatedAt: "2026-11-24T00:00:00.000Z",
  isPrimary: true,
  sortLabel: "The Matrix",
  sortAnchor: "Matrix, The",
  sortSequence: 0,
};

describe("stock table title art", () => {
  afterEach(() => cleanup());

  it("shows compact poster art for each linked title and a placeholder when absent", () => {
    render(
      <table>
        <StockTableBody bulkFormId="bulk" currentStockHref="/inventory/stock" items={[item]} />
      </table>,
    );

    const poster = document.querySelector(".stock-title-art") as HTMLImageElement;
    expect(poster).toBeTruthy();
    expect(poster.alt).toBe("");
    expect(poster.width).toBe(36);
    expect(poster.height).toBe(54);
    expect(screen.getByText("No art")).toBeTruthy();
    expect(screen.getByText("The Matrix (1999)")).toBeTruthy();
    expect(screen.getByText("Custom Feature (2024)")).toBeTruthy();
  });
});
