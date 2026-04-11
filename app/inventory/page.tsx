import Link from "next/link";

import { applyBulkTitleAction } from "@/app/inventory/actions";
import { searchInventoryTitles } from "@/lib/data";
import { formatMediaType, formatMovieTitleWithYear, getAvailabilityLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

type InventoryPageProps = {
  searchParams: Promise<{
    search?: string;
  }>;
};

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const params = await searchParams;
  const titles = await searchInventoryTitles(params.search);

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
        </form>
      </section>
    </div>
  );
}
