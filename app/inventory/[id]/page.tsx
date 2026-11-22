import { deleteTitle } from "@/app/inventory/actions";
import Link from "next/link";

import { getMovieById } from "@/lib/data";
import {
  formatAvailability,
  formatDiscFormat,
  formatInventoryLocation,
  formatInventoryIdentifier,
  formatLinkedTitleLabel,
  formatLongDate,
  formatMediaType,
  formatMovieTitleWithYear,
  formatSealed,
  getAvailabilityLabel,
  getAvailabilityTone,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InventoryTitlePage(props: PageProps<"/inventory/[id]">) {
  const { id } = await props.params;
  const movie = await getMovieById(id);

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <div className="section-heading">
          <div>
            <h1>{formatMovieTitleWithYear(movie.title, movie.releaseDate)}</h1>
            <p className="muted">
              {formatMediaType(movie.mediaType)} |{" "}
              {movie.mediaType === "series" ? "First aired" : "Released"}{" "}
              {formatLongDate(movie.releaseDate)} | Sort title {movie.sortTitle}
            </p>
          </div>
          <div className="header-actions">
            <form action={deleteTitle.bind(null, movie.id)}>
              <button type="submit" className="link-button" disabled={movie.totalCopies > 0}>
                Delete Title
              </button>
            </form>
            <Link href={`/inventory/${movie.id}/edit`}>Edit Title</Link>
            <Link href={`/inventory/new?selected=${movie.id}`}>New Disc</Link>
          </div>
        </div>
        <p>{movie.overview}</p>
        <p className="availability-line">{getAvailabilityLabel(movie)}</p>
        {movie.totalCopies > 0 ? (
          <p className="muted utility-row">Remove all linked discs before deleting this title.</p>
        ) : null}
      </section>

      <section className="section">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Format</th>
              <th>Availability</th>
              <th>Sealed</th>
              <th>Prices</th>
              <th>Late Class</th>
              <th>Titles On Disc</th>
              <th>Location</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {movie.inventoryItems.map((item) => (
              <tr key={item.id}>
                <td>{formatInventoryIdentifier(item)}</td>
                <td>{formatDiscFormat(item.format)}</td>
                <td>
                  <span className={`status-pill status-${getAvailabilityTone(item.availability)}`}>
                    {formatAvailability(item.availability)}
                  </span>
                </td>
                <td>{formatSealed(item.sealed)}</td>
                <td>
                  ${item.dayPrice.toFixed(2)} / ${item.weekendPrice.toFixed(2)}
                </td>
                <td>{item.lateClass}</td>
                <td>
                  {item.linkedTitles.map((title) => formatLinkedTitleLabel(title)).join(", ")}
                </td>
                <td>{formatInventoryLocation(item)}</td>
                <td>{item.notes ?? "—"}</td>
                <td>
                  <Link href={`/inventory/discs/${item.id}`}>Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
