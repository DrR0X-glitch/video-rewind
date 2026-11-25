import Link from "next/link";

import { listStockDiscs } from "@/lib/data";
import { formatReleaseYear } from "@/lib/format";
import { searchMusicTracks } from "@/lib/server/catalog/music-releases";

const RESULT_LIMIT = 100;
export const dynamic = "force-dynamic";

type CdInventoryPageProps = {
  searchParams: Promise<{
    q?: string;
    view?: string;
  }>;
};

type CdInventoryView = "albums" | "songs";

function buildHref(view: CdInventoryView, query: string) {
  const params = new URLSearchParams({ view });
  if (query) params.set("q", query);
  return `/inventory/cds?${params.toString()}`;
}

export default async function CdInventoryPage({ searchParams }: CdInventoryPageProps) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const view: CdInventoryView = params.view === "songs" ? "songs" : "albums";

  const [stock, songs] = await Promise.all([
    view === "albums"
      ? listStockDiscs({
          formats: ["cd"],
          q: query || undefined,
          sort: "location",
          dir: "asc",
          page: 1,
          pageSize: RESULT_LIMIT,
        })
      : Promise.resolve({ items: [], totalCount: 0 }),
    view === "songs" && query ? searchMusicTracks(query, RESULT_LIMIT) : Promise.resolve([]),
  ]);

  const releases = new Map<
    string,
    {
      id: string;
      title: string;
      sortTitle: string;
      artistCredit: string;
      releaseYear: number | null;
      copyCount: number;
      availableCount: number;
    }
  >();
  for (const item of stock.items) {
    const release = item.linkedMusicRelease;
    if (!release) continue;
    const saved = releases.get(release.id);
    if (saved) {
      saved.copyCount += 1;
      if (item.availability) saved.availableCount += 1;
    } else {
      releases.set(release.id, {
        id: release.id,
        title: release.title,
        sortTitle: release.sortTitle,
        artistCredit: release.artistCredit,
        releaseYear: release.releaseYear,
        copyCount: 1,
        availableCount: item.availability ? 1 : 0,
      });
    }
  }
  const albumResults = Array.from(releases.values());

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <div className="section-heading">
          <div>
            <h1>CD Inventory</h1>
            <p className="muted">Search album titles or songs by title or artist.</p>
          </div>
          <div className="header-actions">
            <Link href="/inventory/stock/cds">CD Stock</Link>
            <Link href="/inventory/new/cd">New CD</Link>
            <Link href="/inventory">Back to Titles</Link>
          </div>
        </div>
        <div
          className="button-choice-group cd-inventory-view-selector"
          role="group"
          aria-label="Search by"
        >
          <Link
            href={buildHref("albums", query)}
            className={view === "albums" ? "choice-button choice-button-active" : "choice-button"}
            aria-current={view === "albums" ? "page" : undefined}
          >
            <span>Album titles</span>
          </Link>
          <Link
            href={buildHref("songs", query)}
            className={view === "songs" ? "choice-button choice-button-active" : "choice-button"}
            aria-current={view === "songs" ? "page" : undefined}
          >
            <span>Songs / tracks</span>
          </Link>
        </div>
        <form className="inline-form cd-search-form">
          <input type="hidden" name="view" value={view} />
          <label className="search-label">
            <span>
              {view === "albums" ? "Search albums or artists" : "Search songs or artists"}
            </span>
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder={view === "albums" ? "Album, artist, or copy" : "Song, track, or artist"}
            />
          </label>
          <button type="submit">Search</button>
        </form>
      </section>

      {view === "albums" ? (
        <section className="stock-table-shell">
          <div className="section-heading stock-results-bar">
            <p className="muted utility-row">
              {query
                ? `Showing ${albumResults.length} album titles from up to ${RESULT_LIMIT} matching copies`
                : `Showing ${albumResults.length} album titles from the first ${RESULT_LIMIT} copies`}
            </p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Album title</th>
                <th>Sort title</th>
                <th>Artist</th>
                <th>Year</th>
                <th>Copies</th>
              </tr>
            </thead>
            <tbody>
              {albumResults.map((release) => (
                <tr key={release.id}>
                  <td>
                    <Link href={`/inventory/cds/releases/${release.id}`}>{release.title}</Link>
                  </td>
                  <td>{release.sortTitle}</td>
                  <td>{release.artistCredit || "—"}</td>
                  <td>{release.releaseYear ? formatReleaseYear(release.releaseYear) : "—"}</td>
                  <td>
                    {release.availableCount} available / {release.copyCount} total
                  </td>
                </tr>
              ))}
              {albumResults.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    {query ? "No matching CD albums found." : "No CD albums found in stock."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {stock.totalCount > RESULT_LIMIT ? (
            <p className="muted">
              Showing the first {RESULT_LIMIT} matching physical copies. Search to narrow the list.
            </p>
          ) : null}
        </section>
      ) : (
        <section className="stock-table-shell">
          <div className="section-heading stock-results-bar">
            <p className="muted utility-row">
              {query
                ? `Showing ${songs.length} matching songs (maximum ${RESULT_LIMIT})`
                : "Enter a song title to search stored CD track lists."}
            </p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Song</th>
                <th>Album title</th>
                <th>Artist</th>
                <th>Year</th>
                <th>Copies</th>
              </tr>
            </thead>
            <tbody>
              {songs.map((result) => (
                <tr key={result.track.id}>
                  <td>
                    {result.track.position ? `${result.track.position} ` : ""}
                    {result.track.title}
                  </td>
                  <td>
                    <Link href={`/inventory/cds/releases/${result.release.id}`}>
                      {result.release.title}
                    </Link>
                  </td>
                  <td>{result.release.artistCredit || "—"}</td>
                  <td>
                    {result.release.releaseYear
                      ? formatReleaseYear(result.release.releaseYear)
                      : "—"}
                  </td>
                  <td>
                    {result.inventoryCopies.length > 0 ? (
                      <ul className="plain-list cd-song-copy-list">
                        {result.inventoryCopies.map((copy) => (
                          <li key={copy.id}>
                            <Link href={`/inventory/discs/${copy.id}`}>#{copy.inventoryCode}</Link>
                            <span className="muted">
                              {` · ${copy.availability ? "Available" : "Out"} · ${copy.locationCode}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {query && songs.length === 0 ? (
                <tr>
                  <td colSpan={5}>No matching songs found in CD stock.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
