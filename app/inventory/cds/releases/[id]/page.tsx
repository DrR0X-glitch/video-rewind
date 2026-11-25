import Link from "next/link";
import { notFound } from "next/navigation";

import { getMusicReleaseForStaff } from "@/lib/server/catalog/music-releases";
import { formatReleaseYear } from "@/lib/format";

export const dynamic = "force-dynamic";

function formatDuration(seconds: number | null) {
  if (seconds === null) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default async function CdReleasePage(props: PageProps<"/inventory/cds/releases/[id]">) {
  if (process.env.NODE_ENV !== "development") notFound();

  const { id } = await props.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  let release;
  try {
    release = await getMusicReleaseForStaff(id);
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <div className="section-heading">
          <div>
            <h1>
              {release.title}
              {release.releaseYear ? ` (${formatReleaseYear(release.releaseYear)})` : ""}
            </h1>
            <p className="muted">{release.artistCredit || "Artist unknown"}</p>
          </div>
          <div className="header-actions">
            <Link href="/inventory/stock/cds">Back to CD Stock</Link>
            <Link href="/inventory/new/cd">Add a copy</Link>
          </div>
        </div>
        <p>Sort title: {release.sortTitle}</p>
        {release.country || release.label || release.catalogNumber ? (
          <p className="muted">
            {[release.country, release.label, release.catalogNumber].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {release.source === "discogs" && release.discogsUrl ? (
          <p>
            Release data sourced from Discogs.{" "}
            <a href={release.discogsUrl} target="_blank" rel="noreferrer">
              View this release on Discogs
            </a>
          </p>
        ) : null}
      </section>

      <section className="panel section">
        <h2>Tracks</h2>
        {release.tracks.length > 0 ? (
          <ol className="cd-track-list">
            {release.tracks.map((track) =>
              track.entryType === "heading" ? (
                <li className="cd-track-heading" key={track.id}>
                  {track.title}
                </li>
              ) : (
                <li className="cd-track-row" key={track.id}>
                  <span className="cd-track-name">
                    {track.position ? (
                      <span className="cd-track-position">{track.position}</span>
                    ) : null}
                    <span>{track.title}</span>
                  </span>
                  {track.durationSeconds !== null ? (
                    <span className="cd-track-duration">
                      {formatDuration(track.durationSeconds)}
                    </span>
                  ) : null}
                </li>
              ),
            )}
          </ol>
        ) : (
          <p className="muted">No track listing is recorded for this release.</p>
        )}
      </section>

      <section className="panel section">
        <h2>Physical copies</h2>
        {release.inventoryCopies.length > 0 ? (
          <div className="stock-table-shell">
            <table>
              <thead>
                <tr>
                  <th>Disc</th>
                  <th>UPC/EAN</th>
                  <th>Available?</th>
                  <th>Sealed?</th>
                  <th>Location</th>
                  <th>Day</th>
                  <th>Weekend</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {release.inventoryCopies.map((copy) => (
                  <tr key={copy.id}>
                    <td>
                      <Link href={`/inventory/discs/${copy.id}`}>{copy.inventoryCode}</Link>
                    </td>
                    <td>{copy.upcEan || "—"}</td>
                    <td>{copy.availability ? "Yes" : "No"}</td>
                    <td>{copy.sealed ? "Yes" : "No"}</td>
                    <td>{copy.locationCode}</td>
                    <td>${copy.dayPrice.toFixed(2)}</td>
                    <td>${copy.weekendPrice.toFixed(2)}</td>
                    <td>
                      <Link href={`/inventory/discs/${copy.id}`}>Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No physical copies are in stock for this release.</p>
        )}
      </section>
    </div>
  );
}
