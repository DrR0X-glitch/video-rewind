import Link from "next/link";

import { applyBulkTitleAction } from "@/app/inventory/actions";
import { searchInventoryTitlesPage } from "@/lib/data";
import { formatMediaType, formatMovieTitleWithYear, getAvailabilityLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

const INVENTORY_PAGE_SIZE = 50;

type InventoryPageProps = {
  searchParams: Promise<{
    search?: string;
    page?: string;
  }>;
};

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const params = await searchParams;
  const selectedPage =
    typeof params.page === "string" &&
    /^\d+$/.test(params.page) &&
    Number.parseInt(params.page, 10) > 0
      ? Number.parseInt(params.page, 10)
      : 1;
  const titlePage = await searchInventoryTitlesPage(
    params.search,
    selectedPage,
    INVENTORY_PAGE_SIZE,
  );
  const titles = titlePage.items;
  const totalCount = titlePage.totalCount;
  const totalPages = Math.max(1, Math.ceil(totalCount / INVENTORY_PAGE_SIZE));
  const currentPage = Math.min(selectedPage, totalPages);
  const pageStart = totalCount === 0 ? 0 : (currentPage - 1) * INVENTORY_PAGE_SIZE + 1;
  const pageEnd = totalCount === 0 ? 0 : pageStart + titles.length - 1;
  const previousPageHref =
    currentPage > 1 ? buildInventoryHref(params.search, currentPage - 1) : null;
  const nextPageHref =
    currentPage < totalPages ? buildInventoryHref(params.search, currentPage + 1) : null;

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <div className="section-heading">
          <div>
            <h1>Inventory</h1>
          </div>
          <div className="header-actions">
            <Link href="/inventory/stock">Stock View</Link>
            <Link href="/inventory/new">New Disc</Link>
          </div>
        </div>
        <form className="inline-form">
          <label className="search-label">
            <span>Search title</span>
            <input
              type="text"
              name="search"
              defaultValue={params.search ?? ""}
              placeholder="Search title"
            />
          </label>
          <button type="submit">Search</button>
        </form>
      </section>

      <section className="section">
        <form action={applyBulkTitleAction} className="stack-form">
          <div className="bulk-toolbar">
            <label className="search-label bulk-action-field">
              <span>Bulk action</span>
              <select name="action" defaultValue="feature">
                <option value="feature">Mark featured</option>
                <option value="unfeature">Remove featured</option>
                <option value="delete">Delete title</option>
              </select>
            </label>
            <button type="submit">Apply</button>
          </div>
          <table>
            <thead>
              <tr>
                <th className="selection-column">Select</th>
                <th>Title</th>
                <th>Sort</th>
                <th>Type</th>
                <th>Genres</th>
                <th>Stock</th>
                <th>Copies</th>
              </tr>
            </thead>
            <tbody>
              {titles.map((movie) => (
                <tr key={movie.id}>
                  <td className="selection-column">
                    <input type="checkbox" name="titleIds" value={movie.id} />
                  </td>
                  <td>
                    <Link href={`/inventory/${movie.id}`}>
                      {formatMovieTitleWithYear(movie.title, movie.releaseDate)}
                    </Link>
                  </td>
                  <td>{movie.sortTitle}</td>
                  <td>{formatMediaType(movie.mediaType)}</td>
                  <td>{movie.genres.join(", ")}</td>
                  <td>{getAvailabilityLabel(movie)}</td>
                  <td>{movie.totalCopies}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="section stock-table-footer">
            <p className="muted utility-row">
              {totalCount === 0
                ? "Showing 0 titles"
                : `Showing ${pageStart}-${pageEnd} of ${totalCount}`}
            </p>
            {totalPages > 1 ? (
              <div className="header-actions stock-pagination">
                {previousPageHref ? (
                  <Link href={previousPageHref}>Previous</Link>
                ) : (
                  <span className="muted">Previous</span>
                )}
                <span className="muted">
                  Page {currentPage} of {totalPages}
                </span>
                {nextPageHref ? (
                  <Link href={nextPageHref}>Next</Link>
                ) : (
                  <span className="muted">Next</span>
                )}
              </div>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}

function buildInventoryHref(search: string | undefined, page: number) {
  const params = new URLSearchParams();

  if (search && search.trim()) {
    params.set("search", search.trim());
  }

  if (page > 1) {
    params.set("page", page.toString());
  }

  const query = params.toString();
  return query ? `/inventory?${query}` : "/inventory";
}
