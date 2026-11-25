import Link from "next/link";

import { listStockDiscs } from "@/lib/data";
import {
  formatInventoryLocation,
  formatInventoryShortIdentifier,
  formatReleaseYear,
} from "@/lib/format";
import { listInventoryZones } from "@/lib/server/inventory/zones";

type CdStockPageProps = {
  searchParams: Promise<{
    availability?: string | string[];
    page?: string;
    q?: string;
    sealed?: string | string[];
    zone?: string;
  }>;
};

const PAGE_SIZE = 50;

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function buildHref(input: {
  q: string;
  availability: string;
  sealed: string;
  zone: string;
  page: number;
}) {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.availability !== "all") params.set("availability", input.availability);
  if (input.sealed !== "all") params.set("sealed", input.sealed);
  if (input.zone) params.set("zone", input.zone);
  if (input.page > 1) params.set("page", String(input.page));
  const query = params.toString();
  return query ? `/inventory/stock/cds?${query}` : "/inventory/stock/cds";
}

export default async function CdStockPage({ searchParams }: CdStockPageProps) {
  const params = await searchParams;
  const zones = await listInventoryZones();
  const zone = zones.some((option) => option.code === params.zone) ? params.zone! : "";
  const availability = ["all", "available", "out"].includes(firstValue(params.availability))
    ? firstValue(params.availability) || "all"
    : "all";
  const sealed = ["all", "true", "false"].includes(firstValue(params.sealed))
    ? firstValue(params.sealed) || "all"
    : "all";
  const q = params.q?.trim() ?? "";
  const requestedPage = /^\d+$/.test(params.page ?? "") ? Number(params.page) : 1;
  const stock = await listStockDiscs({
    formats: ["cd"],
    q,
    availability,
    sealedStates: sealed === "all" ? [] : [sealed],
    zones: zone ? [zone] : [],
    sort: "location",
    dir: "asc",
    page: requestedPage,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(stock.totalCount / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const start = stock.totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, stock.totalCount);
  const filtered = { q, availability, sealed, zone };

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <div className="section-heading">
          <div>
            <h1>CD Stock</h1>
            <p className="muted">Physical CD copies</p>
          </div>
          <div className="header-actions">
            <Link href="/inventory/cds">CD Inventory</Link>
            <Link href="/inventory/stock">All Stock</Link>
            <Link href="/inventory">Back to Titles</Link>
          </div>
        </div>
      </section>

      <section className="panel section">
        <form className="stock-filter-bar">
          <label className="search-label bulk-action-field">
            <span>Search</span>
            <input type="text" name="q" defaultValue={q} placeholder="Release, artist, location" />
          </label>
          <label className="search-label">
            <span>Availability</span>
            <select name="availability" defaultValue={availability}>
              <option value="all">All</option>
              <option value="available">Available</option>
              <option value="out">Out</option>
            </select>
          </label>
          <label className="search-label">
            <span>Sealed</span>
            <select name="sealed" defaultValue={sealed}>
              <option value="all">All</option>
              <option value="true">Sealed</option>
              <option value="false">Open</option>
            </select>
          </label>
          <label className="search-label">
            <span>Zone</span>
            <select name="zone" defaultValue={zone}>
              <option value="">All zones</option>
              {zones.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                  {option.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Filter</button>
        </form>
      </section>

      <section className="stock-table-shell">
        <div className="section-heading stock-results-bar">
          <p className="muted utility-row">
            {stock.totalCount === 0
              ? "Showing 0 CDs"
              : `Showing ${start}-${end} of ${stock.totalCount} CDs`}
          </p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Disc</th>
              <th>Release</th>
              <th>Artist</th>
              <th>Year</th>
              <th>UPC/EAN</th>
              <th>Available?</th>
              <th>Sealed?</th>
              <th>Location</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {stock.items.map((item) => {
              const release = item.linkedMusicRelease;
              return (
                <tr key={item.id}>
                  <td>
                    <Link href={`/inventory/discs/${item.id}`}>
                      {formatInventoryShortIdentifier(item)}
                    </Link>
                  </td>
                  <td>
                    {release ? (
                      <Link href={`/inventory/cds/releases/${release.id}`}>{release.title}</Link>
                    ) : (
                      "Unlinked CD release"
                    )}
                  </td>
                  <td>{release?.artistCredit || "—"}</td>
                  <td>{release?.releaseYear ? formatReleaseYear(release.releaseYear) : "—"}</td>
                  <td>{item.upcEan || "—"}</td>
                  <td>{item.availability ? "Yes" : "No"}</td>
                  <td>{item.sealed ? "Yes" : "No"}</td>
                  <td>{formatInventoryLocation(item)}</td>
                  <td>{item.notes || "—"}</td>
                  <td>
                    <Link href={`/inventory/discs/${item.id}`}>Edit</Link>
                  </td>
                </tr>
              );
            })}
            {stock.items.length === 0 ? (
              <tr>
                <td colSpan={10}>No CDs found for the current filters.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {totalPages > 1 ? (
          <div className="header-actions stock-pagination">
            {page > 1 ? (
              <Link href={buildHref({ ...filtered, page: page - 1 })}>Previous</Link>
            ) : null}
            <span>
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={buildHref({ ...filtered, page: page + 1 })}>Next</Link>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
